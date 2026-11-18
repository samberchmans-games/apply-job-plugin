# pdf.js (vendored)

Mozilla pdf.js, used only to read text from PDF resumes (src/lib/pdf.js). Loaded on demand, not at startup.

- Package: `pdfjs-dist@4.10.38`, files from `legacy/build/` (wider browser support)
- License: Apache-2.0 (see LICENSE)
- Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.10.38.tgz
- Verified against the registry's integrity hash: `sha512-/Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ==`
- Security: newer than 4.2.67 (fixes CVE-2024-4367); we also pass `isEvalSupported: false`.

To update: download the new tarball, verify its sha512 against `https://registry.npmjs.org/pdfjs-dist/<version>`, copy the two files, update this note, and run the tests.
