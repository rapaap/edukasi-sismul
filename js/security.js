/**
 * ============================================================
 *  EngliKids — security.js
 *  Tim: Keamanan & Kompresi (Fatoni, Fadil, Galih)
 *
 *  Berisi 3 fungsi utilitas murni (tidak ada DOM/UI):
 *    1. hashPassword(password)  → SHA-256 via Web Crypto API
 *    2. compressRLE(text)       → Run-Length Encoding
 *    3. decompressRLE(text)     → Dekompresi RLE
 * ============================================================
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   1.  SHA-256  —  hashPassword(password)
   ════════════════════════════════════════════════════════════
   Menggunakan window.crypto.subtle (Web Crypto API bawaan browser).
   Fungsi ini bersifat ASYNC karena crypto.subtle.digest() mengembalikan
   Promise. Hasil akhirnya berupa string HEX 64 karakter.

   Cara pakai:
     const hash = await hashPassword("rahasia123");
     console.log(hash);
     // "a665a45920422f9d...c99" (64 karakter hex)
   ════════════════════════════════════════════════════════════ */

/**
 * Menghasilkan hash SHA-256 dari sebuah string password.
 *
 * @param   {string} password  - Teks yang akan di-hash (plain-text).
 * @returns {Promise<string>}  - Promise yang resolve ke string HEX 64 karakter.
 * @throws  {Error}            - Jika Web Crypto API tidak didukung browser.
 */
async function hashPassword(password) {
  // ── Validasi tipe input ──────────────────────────────────
  if (typeof password !== 'string') {
    throw new TypeError('[hashPassword] Password harus bertipe string.');
  }
  if (password.length === 0) {
    throw new RangeError('[hashPassword] Password tidak boleh kosong.');
  }

  // ── Cek ketersediaan Web Crypto API ─────────────────────
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error(
      '[hashPassword] window.crypto.subtle tidak tersedia. ' +
      'Pastikan halaman diakses melalui HTTPS atau localhost.'
    );
  }

  // ── Langkah 1: Encode string → ArrayBuffer (UTF-8) ──────
  //   TextEncoder mengubah setiap karakter menjadi byte sesuai standar UTF-8,
  //   sehingga karakter non-ASCII (misal: huruf Arab/Jepang) tetap ditangani
  //   dengan benar.
  const encoder    = new TextEncoder();
  const dataBuffer = encoder.encode(password); // Uint8Array

  // ── Langkah 2: Hitung digest SHA-256 ────────────────────
  //   crypto.subtle.digest() mengembalikan Promise<ArrayBuffer>.
  //   'SHA-256' menghasilkan output 256 bit = 32 byte.
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);

  // ── Langkah 3: Konversi ArrayBuffer → Array of bytes ────
  const hashArray  = Array.from(new Uint8Array(hashBuffer)); // [72, 101, 108, ...]

  // ── Langkah 4: Konversi setiap byte → 2 digit HEX ───────
  //   padStart(2, '0') memastikan byte < 16 tetap ditulis 2 digit (misal: 0x0A → "0a").
  const hashHex    = hashArray
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');                                               // "a1b2c3d4..."

  return hashHex; // Panjang selalu 64 karakter
}


/* ════════════════════════════════════════════════════════════
   2.  RUN-LENGTH ENCODING  —  compressRLE(text)
   ════════════════════════════════════════════════════════════
   Algoritma RLE bekerja dengan mengganti urutan karakter yang
   BERULANG dengan pasangan [jumlah][karakter].

   Contoh:
     "AAABBC"     → "3A2B1C"
     "AABBBCCCC"  → "2A3B4C"
     "HELLO"      → "1H1E2L1O"

   FORMAT OUTPUT  :  <count><char>  diulang untuk setiap run.
   SEPARATOR ANGKA:  Karena count bisa > 9, kita pakai separator "|"
   antara pasangan agar aman untuk teks arbitrer:
     "2A|3B|4C"

   Kenapa pakai separator?
     Tanpa separator, "12A" ambigu: apakah "1" run of "2A"
     atau "12" run of "A"? Dengan "|" ini:
       "12|A" = 12 karakter 'A' (jelas).

   Cara pakai:
     compressRLE("AAABBBCC")  → "3|A|3|B|2|C"
     decompressRLE("3|A|3|B|2|C") → "AAABBBCC"
   ════════════════════════════════════════════════════════════ */

// Karakter pemisah antar pasangan count-char.
// Dipilih karakter yang sangat jarang muncul di teks normal.
const RLE_SEPARATOR = '|';

/**
 * Mengompresi string menggunakan algoritma Run-Length Encoding.
 *
 * @param   {string} text  - String input yang akan dikompresi.
 * @returns {string}       - String hasil kompresi dalam format "count|char|count|char|..."
 *                           atau string kosong jika input kosong.
 * @throws  {TypeError}    - Jika input bukan string.
 */
function compressRLE(text) {
  // ── Validasi ─────────────────────────────────────────────
  if (typeof text !== 'string') {
    throw new TypeError('[compressRLE] Input harus bertipe string.');
  }
  if (text.length === 0) return '';

  // ── Algoritma RLE ─────────────────────────────────────────
  const hasil = []; // Menampung pasangan {count, char}

  let i = 0;
  while (i < text.length) {
    const charSaatIni = text[i]; // Karakter yang sedang dihitung
    let   jumlah      = 1;

    // Hitung berapa kali karakter ini berulang secara berturut-turut
    while (i + jumlah < text.length && text[i + jumlah] === charSaatIni) {
      jumlah++;
    }

    // Simpan pasangan count + char
    hasil.push(jumlah, charSaatIni);

    // Lompat ke karakter run berikutnya
    i += jumlah;
  }

  // Gabungkan dengan separator
  // Contoh: [3,'A',2,'B',1,'C'] → "3|A|2|B|1|C"
  return hasil.join(RLE_SEPARATOR);
}


/**
 * Mendekompresi string hasil compressRLE kembali ke string aslinya.
 *
 * @param   {string} compressedText - String terkompresi dalam format "count|char|..."
 * @returns {string}                - String asli yang sudah dipulihkan.
 * @throws  {TypeError}             - Jika input bukan string.
 * @throws  {Error}                 - Jika format kompresi tidak valid.
 */
function decompressRLE(compressedText) {
  // ── Validasi ─────────────────────────────────────────────
  if (typeof compressedText !== 'string') {
    throw new TypeError('[decompressRLE] Input harus bertipe string.');
  }
  if (compressedText.length === 0) return '';

  // ── Pisahkan token menggunakan separator ─────────────────
  // Contoh: "3|A|2|B|1|C" → ["3","A","2","B","1","C"]
  const token = compressedText.split(RLE_SEPARATOR);

  // Jumlah token harus GENAP (setiap pasangan = count + char)
  if (token.length % 2 !== 0) {
    throw new Error(
      '[decompressRLE] Format string kompresi tidak valid. ' +
      `Jumlah token (${token.length}) harus genap.`
    );
  }

  // ── Rekonstruksi string asli ──────────────────────────────
  let hasil = '';
  for (let i = 0; i < token.length; i += 2) {
    const count = parseInt(token[i], 10); // Token genap = jumlah pengulangan
    const char  = token[i + 1];          // Token ganjil = karakternya

    // Validasi count
    if (isNaN(count) || count < 1) {
      throw new Error(
        `[decompressRLE] Nilai count tidak valid pada posisi token ${i}: "${token[i]}"`
      );
    }
    // Validasi char (harus tepat 1 karakter)
    if (char === undefined || char.length !== 1) {
      throw new Error(
        `[decompressRLE] Karakter tidak valid pada posisi token ${i + 1}: "${char}"`
      );
    }

    // Tambahkan karakter sebanyak 'count' kali
    hasil += char.repeat(count);
  }

  return hasil;
}


/* ════════════════════════════════════════════════════════════
   3.  UTILITAS TAMBAHAN  —  getRatio(original, compressed)
   ════════════════════════════════════════════════════════════
   Fungsi bantu untuk mengukur efektivitas kompresi.
   Berguna saat demo/presentasi untuk menunjukkan rasio kompresi.
   ════════════════════════════════════════════════════════════ */

/**
 * Menghitung rasio kompresi antara string asli dan string terkompresi.
 *
 * @param   {string} original    - String asli sebelum dikompresi.
 * @param   {string} compressed  - String setelah dikompresi.
 * @returns {{ originalLen: number, compressedLen: number,
 *             ratio: string, isEffective: boolean }}
 */
function getCompressionRatio(original, compressed) {
  const originalLen    = original.length;
  const compressedLen  = compressed.length;
  const rasio          = ((1 - compressedLen / originalLen) * 100).toFixed(2);
  const isEffective    = compressedLen < originalLen;

  return {
    originalLen,
    compressedLen,
    ratio      : `${rasio}%`,         // Positif = lebih kecil, Negatif = lebih besar
    isEffective,                       // true jika kompresi benar-benar mengecilkan ukuran
  };
}


/* ════════════════════════════════════════════════════════════
   EXPORT  —  expose ke scope global (tanpa bundler/module)
   ════════════════════════════════════════════════════════════
   Karena proyek ini Vanilla JS murni tanpa module bundler,
   semua fungsi di-attach ke window agar bisa dipanggil
   dari file JS lain maupun console browser.
   ════════════════════════════════════════════════════════════ */
window.EngliKidsSecurity = {
  hashPassword,
  compressRLE,
  decompressRLE,
  getCompressionRatio,
};


/* ════════════════════════════════════════════════════════════
   SELF-TEST  —  Berjalan otomatis di console saat file dimuat.
   Hapus blok ini sebelum produksi / presentasi jika tidak diperlukan.
   ════════════════════════════════════════════════════════════ */
(async function selfTest() {
  console.groupCollapsed('%c[EngliKids Security] Self-Test', 'color:#A06CD5;font-weight:bold;');

  // ── Test SHA-256 ────────────────────────────────────────
  console.log('%c── SHA-256 Hash ──', 'color:#4DA8DA;font-weight:bold;');
  try {
    const hash1 = await hashPassword('apple123');
    const hash2 = await hashPassword('apple123'); // Harus SAMA (deterministik)
    const hash3 = await hashPassword('Apple123'); // Harus BEDA (case-sensitive)

    console.assert(hash1.length === 64,       '✗ Panjang hash harus 64 karakter');
    console.assert(hash1 === hash2,           '✗ Hash yang sama harus menghasilkan output yang sama');
    console.assert(hash1 !== hash3,           '✗ Password berbeda harus menghasilkan hash berbeda');
    console.assert(/^[0-9a-f]+$/.test(hash1), '✗ Hash harus berupa hex lowercase');

    console.log('✓ hashPassword("apple123") =', hash1);
    console.log('✓ Deterministik            :', hash1 === hash2);
    console.log('✓ Case-sensitive           :', hash1 !== hash3);
  } catch (err) {
    console.error('✗ hashPassword error:', err.message);
  }

  // ── Test RLE Compress ───────────────────────────────────
  console.log('%c── RLE Compress ──', 'color:#FF6B6B;font-weight:bold;');
  const kasusUji = [
    { input: 'AAABBBCC',      harusJadi: '3|A|3|B|2|C'      },
    { input: 'HELLO',          harusJadi: '1|H|1|E|2|L|1|O'  },
    { input: 'AAAAAAAAAABC',   harusJadi: '10|A|1|B|1|C'     },
    { input: 'X',              harusJadi: '1|X'               },
    { input: '',               harusJadi: ''                   },
  ];

  kasusUji.forEach(({ input, harusJadi }) => {
    const hasil  = compressRLE(input);
    const lulus  = hasil === harusJadi;
    console.assert(lulus, `✗ compressRLE("${input}") = "${hasil}" (harusnya "${harusJadi}")`);
    if (lulus) console.log(`✓ compressRLE("${input}") = "${hasil}"`);
  });

  // ── Test RLE Decompress (Round-trip) ────────────────────
  console.log('%c── RLE Decompress (Round-trip) ──', 'color:#6BCB77;font-weight:bold;');
  const stringUji = ['AAABBBCC', 'HELLO WORLD', 'EngliKids123', 'AAAAAAAAAABC'];
  stringUji.forEach(str => {
    const compressed   = compressRLE(str);
    const decompressed = decompressRLE(compressed);
    const lulus        = decompressed === str;
    console.assert(lulus, `✗ Round-trip gagal untuk "${str}"`);
    if (lulus) {
      const rasio = getCompressionRatio(str, compressed);
      console.log(
        `✓ "${str}" → compress → decompress → "${decompressed}"`,
        `| Rasio: ${rasio.ratio} (${rasio.isEffective ? 'efektif' : 'tidak efektif untuk string ini'})`
      );
    }
  });

  console.log('%c[EngliKids Security] Self-Test Selesai ✓', 'color:#A06CD5;font-weight:bold;');
  console.groupEnd();
})();
