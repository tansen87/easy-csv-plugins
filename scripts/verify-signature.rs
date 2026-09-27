// Standalone check: does the catalog signature verify with `minisign-verify`,
// the exact crate + call shape `tauri-plugin-updater` uses?
//
//   verify-signature <catalog> <catalog.sig> <pubkey>
//
// Compile it against the app repository's already-built rlib, so this needs no
// cargo project, no network and no `minisign` binary:
//
//   APP=../easy-csv
//   rustc --edition 2021 -L dependency=$APP/src-tauri/target/debug/deps \
//         --extern minisign_verify=$(ls $APP/src-tauri/target/debug/deps/libminisign_verify-*.rlib | head -1) \
//         scripts/verify-signature.rs -o /tmp/verify-signature
//   /tmp/verify-signature catalog.json catalog.json.sig plugin-signing.pub
//
// It also flips one byte and re-verifies, so a passing run proves the check is
// not vacuous. Run it after any change to the signing or build-catalog scripts.
//
// Base64 is decoded by hand so this compiles against a single extern rlib.
use std::fs;

use minisign_verify::{PublicKey, Signature};

fn b64(input: &str) -> Vec<u8> {
  let mut out = Vec::new();
  let mut buffer: u32 = 0;
  let mut bits: u32 = 0;
  for byte in input.bytes() {
    let value = match byte {
      b'A'..=b'Z' => byte - b'A',
      b'a'..=b'z' => byte - b'a' + 26,
      b'0'..=b'9' => byte - b'0' + 52,
      b'+' => 62,
      b'/' => 63,
      _ => continue, // padding and newlines
    } as u32;
    buffer = (buffer << 6) | value;
    bits += 6;
    if bits >= 8 {
      bits -= 8;
      out.push((buffer >> bits) as u8);
    }
  }
  out
}

fn main() {
  let args: Vec<String> = std::env::args().collect();
  if args.len() != 4 {
    eprintln!("usage: verify_sig <catalog> <catalog.sig> <pubkey>");
    std::process::exit(2);
  }

  let public_key_text =
    String::from_utf8(b64(fs::read_to_string(&args[3]).unwrap().trim())).expect("pubkey utf8");
  let public_key = PublicKey::decode(&public_key_text).expect("pubkey decode");

  let data = fs::read(&args[1]).expect("read catalog");
  let signature_text =
    String::from_utf8(b64(fs::read_to_string(&args[2]).unwrap().trim())).expect("sig utf8");
  let signature = Signature::decode(&signature_text).expect("signature decode");

  // `true` = allow legacy (non-prehashed) signatures, same as the updater.
  match public_key.verify(&data, &signature, true) {
    Ok(()) => println!("SIGNATURE OK ({} bytes)", data.len()),
    Err(error) => {
      println!("SIGNATURE FAILED: {error:?}");
      std::process::exit(1);
    }
  }

  // A one-byte change must break it; otherwise the check above proves nothing.
  if !data.is_empty() {
    let mut tampered = data.clone();
    tampered[0] ^= 0xff;
    match public_key.verify(&tampered, &signature, true) {
      Ok(()) => {
        println!("TAMPER CHECK FAILED: modified bytes still verify");
        std::process::exit(1);
      }
      Err(_) => println!("tamper check OK (modified catalog rejected)"),
    }
  }
}
