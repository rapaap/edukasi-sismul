/**
 * ============================================================
 *  EngliKids — dsp.js
 *  Tim: DSP / Sinyal (Iqbal, Rafa, Dandi)
 *
 *  Berisi pipeline pemrosesan sinyal digital (DSP) lengkap:
 *    1. Akses Mikrofon  — requestMicrophone()
 *    2. Rekam + Filter  — startRecording() / stopRecording()
 *    3. High-Pass Filter — BiquadFilterNode (cutoff 85 Hz)
 *    4. Korelasi Sinyal — calculateCorrelation(buf1, buf2)
 *    5. Skor Akhir      — scorePronunciation(recorded, reference)
 *
 *  Semua fungsi di-expose via window.EngliKidsDSP
 * ============================================================
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   KONSTANTA KONFIGURASI DSP
   ════════════════════════════════════════════════════════════ */
const DSP_CONFIG = {
  // High-pass filter: buang frekuensi di bawah ini (Hz)
  // 85 Hz dipilih karena suara konsonan & vokal bahasa Inggris
  // dimulai sekitar 85–100 Hz. Di bawah itu umumnya noise AC/kipas.
  HIGH_PASS_CUTOFF_HZ : 85,

  // Q-factor BiquadFilter: seberapa tajam lereng filter.
  // Nilai 0.7 = Butterworth (relatif flat, tidak terlalu curam).
  HIGH_PASS_Q         : 0.7,

  // Sample rate target. Browser modern umumnya 44100 atau 48000 Hz.
  SAMPLE_RATE         : 44100,

  // Durasi maksimum rekaman otomatis (ms)
  MAX_RECORD_DURATION : 5000,

  // Threshold amplitudo untuk deteksi "suara ada" (0.0 – 1.0)
  // Sinyal di bawah nilai ini dianggap hening / noise lantai.
  SILENCE_THRESHOLD   : 0.01,

  // Ukuran frame untuk analisis FFT (harus pangkat 2)
  FFT_SIZE            : 2048,
};

/* ════════════════════════════════════════════════════════════
   STATE INTERNAL MODUL
   ════════════════════════════════════════════════════════════ */
let _audioContext   = null;   // AudioContext tunggal (singleton)
let _mediaStream    = null;   // Stream dari mikrofon
let _mediaRecorder  = null;   // MediaRecorder untuk menyimpan blob
let _audioChunks    = [];     // Buffer chunk rekaman
let _isRecording    = false;  // Flag status

/* ════════════════════════════════════════════════════════════
   1.  INISIALISASI AudioContext  (singleton)
   ════════════════════════════════════════════════════════════
   AudioContext dibuat SATU KALI dan di-reuse, karena browser
   membatasi jumlah context yang bisa dibuat sekaligus.
   ════════════════════════════════════════════════════════════ */

/**
 * Mendapatkan (atau membuat) AudioContext singleton.
 * Menangani prefix webkit untuk Safari lama.
 *
 * @returns {AudioContext}
 */
function getAudioContext() {
  if (_audioContext && _audioContext.state !== 'closed') {
    return _audioContext;
  }
  const AudioCtx  = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('[DSP] Web Audio API tidak didukung browser ini.');
  }
  _audioContext = new AudioCtx({ sampleRate: DSP_CONFIG.SAMPLE_RATE });
  return _audioContext;
}

/* ════════════════════════════════════════════════════════════
   2.  AKSES MIKROFON  —  requestMicrophone()
   ════════════════════════════════════════════════════════════ */

/**
 * Meminta izin akses mikrofon ke browser.
 * Harus dipanggil sebagai respons interaksi pengguna (klik tombol).
 *
 * @returns {Promise<MediaStream>} - Stream audio dari mikrofon.
 * @throws  {Error}                - Jika izin ditolak atau hardware tidak ada.
 */
async function requestMicrophone() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('[DSP] navigator.mediaDevices.getUserMedia tidak tersedia.');
  }

  const constraints = {
    audio: {
      // Matikan pemrosesan bawaan browser agar DSP kita yang bekerja penuh
      echoCancellation    : false,  // Kita handle sendiri via filter
      noiseSuppression    : false,  // Kita handle sendiri via high-pass
      autoGainControl     : false,  // Agar amplitudo tidak dinormalisasi otomatis
      channelCount        : 1,      // Mono — lebih efisien untuk analisis
      sampleRate          : DSP_CONFIG.SAMPLE_RATE,
    },
  };

  try {
    _mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[DSP] ✓ Akses mikrofon berhasil.', _mediaStream.getAudioTracks()[0].label);
    return _mediaStream;
  } catch (err) {
    const pesan = {
      NotAllowedError    : 'Izin mikrofon ditolak pengguna.',
      NotFoundError      : 'Tidak ada perangkat mikrofon yang ditemukan.',
      NotReadableError   : 'Mikrofon sedang dipakai aplikasi lain.',
      OverconstrainedError: 'Perangkat tidak mendukung konfigurasi audio yang diminta.',
    };
    throw new Error(`[DSP] ${pesan[err.name] || err.message}`);
  }
}

/* ════════════════════════════════════════════════════════════
   3.  HIGH-PASS FILTER  —  createHighPassFilter()
   ════════════════════════════════════════════════════════════
   BiquadFilterNode adalah implementasi filter IIR (Infinite Impulse
   Response) di Web Audio API. Filter tipe 'highpass' melewatkan
   frekuensi DI ATAS cutoff dan MEMOTONG frekuensi di bawahnya.

   Secara matematis, BiquadFilter menerapkan persamaan diferensi:
     y[n] = (b0/a0)*x[n] + (b1/a0)*x[n-1] + (b2/a0)*x[n-2]
           - (a1/a0)*y[n-1] - (a2/a0)*y[n-2]

   Browser menghitung koefisien b0,b1,b2,a0,a1,a2 secara otomatis
   berdasarkan parameter frequency dan Q yang kita berikan.
   ════════════════════════════════════════════════════════════ */

/**
 * Membuat dan mengembalikan BiquadFilterNode high-pass yang sudah dikonfigurasi.
 *
 * @param   {AudioContext} ctx  - AudioContext aktif.
 * @returns {BiquadFilterNode}
 */
function createHighPassFilter(ctx) {
  const filter       = ctx.createBiquadFilter();
  filter.type        = 'highpass';

  // Frekuensi cutoff: sinyal di bawah 85 Hz dipotong
  filter.frequency.setValueAtTime(DSP_CONFIG.HIGH_PASS_CUTOFF_HZ, ctx.currentTime);

  // Q-factor: lebar/tajam transisi di sekitar cutoff
  filter.Q.setValueAtTime(DSP_CONFIG.HIGH_PASS_Q, ctx.currentTime);

  return filter;
}

/* ════════════════════════════════════════════════════════════
   4.  REKAM SUARA  —  startRecording() / stopRecording()
   ════════════════════════════════════════════════════════════
   Pipeline audio:
     [Mikrofon] → [MediaStreamSource] → [BiquadFilter HP]
               → [MediaStreamDestination] → [MediaRecorder]

   MediaStreamDestination adalah node "jembatan" yang mengubah
   output graph Web Audio API kembali menjadi MediaStream sehingga
   bisa direkam oleh MediaRecorder.
   ════════════════════════════════════════════════════════════ */

/**
 * Memulai perekaman audio dari mikrofon, dengan high-pass filter aktif.
 *
 * @param   {object}   [options]
 * @param   {number}   [options.maxDuration]    - Batas waktu rekaman (ms). Default: DSP_CONFIG.MAX_RECORD_DURATION
 * @param   {Function} [options.onVolumeUpdate] - Callback(volume: 0.0–1.0) dipanggil tiap ~50ms untuk update UI waveform.
 * @returns {Promise<void>}
 * @throws  {Error} - Jika mikrofon belum diminta atau sudah merekam.
 */
async function startRecording({ maxDuration, onVolumeUpdate } = {}) {
  if (_isRecording) {
    throw new Error('[DSP] Rekaman sudah berjalan. Panggil stopRecording() dulu.');
  }

  // Pastikan stream mikrofon sudah ada; jika belum, minta dulu
  if (!_mediaStream) {
    await requestMicrophone();
  }

  const ctx         = getAudioContext();

  // Jika context di-suspend oleh browser (policy autoplay), resume dulu
  if (ctx.state === 'suspended') await ctx.resume();

  // ── Bangun graf audio ────────────────────────────────────
  // Node 1: Sumber suara dari mikrofon
  const source      = ctx.createMediaStreamSource(_mediaStream);

  // Node 2: High-pass filter (buang noise dengung rendah)
  const hpFilter    = createHighPassFilter(ctx);

  // Node 3: Analyser — untuk mengukur volume real-time (opsional, utk UI)
  const analyser    = ctx.createAnalyser();
  analyser.fftSize  = DSP_CONFIG.FFT_SIZE;

  // Node 4: Destination — konversi balik ke MediaStream untuk direkam
  const destination = ctx.createMediaStreamDestination();

  // Sambungkan graf: source → hpFilter → analyser → destination
  source.connect(hpFilter);
  hpFilter.connect(analyser);
  analyser.connect(destination);

  // ── Mulai MediaRecorder ──────────────────────────────────
  _audioChunks  = [];
  _mediaRecorder = new MediaRecorder(destination.stream, {
    mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm',
  });

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) _audioChunks.push(e.data);
  };

  _mediaRecorder.start(100); // Kumpulkan chunk tiap 100ms
  _isRecording = true;
  console.log('[DSP] ▶ Rekaman dimulai (dengan high-pass filter aktif).');

  // ── Monitoring volume real-time (untuk waveform UI) ─────
  if (typeof onVolumeUpdate === 'function') {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!_isRecording) return;
      analyser.getByteTimeDomainData(dataArray);

      // Hitung RMS (Root Mean Square) sebagai ukuran volume
      let sumOfSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128; // Konversi 0-255 → -1.0 to 1.0
        sumOfSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumOfSquares / dataArray.length); // 0.0 – 1.0
      onVolumeUpdate(rms);

      setTimeout(tick, 50); // Update setiap 50ms
    };
    tick();
  }

  // ── Auto-stop setelah maxDuration ───────────────────────
  const batas = maxDuration || DSP_CONFIG.MAX_RECORD_DURATION;
  setTimeout(() => {
    if (_isRecording) {
      console.log(`[DSP] ⏱ Auto-stop setelah ${batas}ms.`);
      stopRecording();
    }
  }, batas);
}

/**
 * Menghentikan rekaman dan mengembalikan AudioBuffer hasil rekaman
 * yang sudah melalui high-pass filter.
 *
 * @returns {Promise<AudioBuffer>} - AudioBuffer siap dianalisis.
 */
function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!_isRecording || !_mediaRecorder) {
      reject(new Error('[DSP] Tidak ada rekaman yang sedang berjalan.'));
      return;
    }

    _mediaRecorder.onstop = async () => {
      _isRecording = false;
      console.log('[DSP] ■ Rekaman dihentikan. Memproses audio...');

      try {
        // Gabungkan semua chunk menjadi satu Blob
        const blob        = new Blob(_audioChunks, { type: _mediaRecorder.mimeType });
        const arrayBuffer = await blob.arrayBuffer();

        // Decode Blob audio → AudioBuffer (PCM float32)
        const ctx         = getAudioContext();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        console.log(`[DSP] ✓ Audio decoded: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);
        // Simpan ke global agar main.js bisa akses jika terjadi race condition auto-stop
        window._lastRecordedBuffer = audioBuffer;
        resolve(audioBuffer);
      } catch (err) {
        reject(new Error(`[DSP] Gagal decode audio: ${err.message}`));
      }
    };

    _mediaRecorder.stop();
  });
}

/* ════════════════════════════════════════════════════════════
   5.  EKSTRAKSI FITUR  —  extractFeatures(audioBuffer)
   ════════════════════════════════════════════════════════════
   Fitur yang diekstrak dari BAGIAN AKTIF sinyal saja (bukan seluruh
   buffer yang mungkin 90% hening):
     a) RMS Energy        — kekuatan suara pada bagian aktif
     b) Zero-Crossing Rate (ZCR) — karakter konsonan/vokal
     c) Spectral Centroid — estimasi ringan via energi per band
     d) Durasi efektif    — panjang bagian bersuara
     e) activeSamples     — array PCM bagian aktif saja (untuk korelasi)
   ════════════════════════════════════════════════════════════ */

/**
 * Mengekstrak vektor fitur dari AudioBuffer.
 * FIX: Semua fitur dihitung dari BAGIAN AKTIF saja, bukan seluruh buffer.
 * Ini mengatasi masalah rekaman 4 detik dengan suara hanya 0.5 detik di tengah.
 *
 * @param   {AudioBuffer} audioBuffer
 * @returns {{ rms, zcr, spectralCentroid, durasiEfektif, activeSamples }}
 */
function extractFeatures(audioBuffer) {
  const samples = audioBuffer.getChannelData(0);
  const N       = samples.length;
  const sr      = audioBuffer.sampleRate;

  // ── Langkah 0: Isolasi bagian AKTIF (di atas threshold) ──
  // FIX BUG #1: Versi lama menghitung fitur dari seluruh buffer.
  // Rekaman 4 detik dengan ucapan 0.5 detik = 87.5% data hening yang
  // merusak semua perhitungan RMS, ZCR, dan korelasi.
  // Solusi: potong hening di awal dan akhir, hanya proses bagian bersuara.
  let startIdx = 0;
  let endIdx   = N - 1;

  // Cari sample pertama yang di atas threshold (dari depan)
  for (let i = 0; i < N; i++) {
    if (Math.abs(samples[i]) > DSP_CONFIG.SILENCE_THRESHOLD) { startIdx = i; break; }
  }
  // Cari sample terakhir yang di atas threshold (dari belakang)
  for (let i = N - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) > DSP_CONFIG.SILENCE_THRESHOLD) { endIdx = i; break; }
  }

  // Tambahkan padding 10ms di kedua sisi agar tidak terpotong terlalu ketat
  const pad = Math.floor(sr * 0.01);
  startIdx  = Math.max(0, startIdx - pad);
  endIdx    = Math.min(N - 1, endIdx + pad);

  // Jika tidak ada suara sama sekali, gunakan seluruh buffer
  if (endIdx <= startIdx) { startIdx = 0; endIdx = N - 1; }

  const activeSamples = samples.slice(startIdx, endIdx + 1);
  const M             = activeSamples.length;

  // ── a) RMS Energy pada bagian aktif ──────────────────────
  let sumSq = 0;
  for (let i = 0; i < M; i++) sumSq += activeSamples[i] * activeSamples[i];
  const rms = Math.sqrt(sumSq / M);

  // ── b) Zero-Crossing Rate pada bagian aktif ──────────────
  let crossings = 0;
  for (let i = 1; i < M; i++) {
    if ((activeSamples[i] >= 0) !== (activeSamples[i - 1] >= 0)) crossings++;
  }
  const zcr = crossings / M;

  // ── c) Spectral Centroid — estimasi via 3 band energi ────
  // FIX BUG #2: DFT naif O(N²) dengan winSize=2048 terlalu lambat dan
  // tidak stabil untuk sinyal pendek. Ganti dengan estimasi band energi
  // yang jauh lebih cepat (O(N)) dan lebih robust.
  //
  // Bagi frekuensi menjadi 3 band berdasarkan sample index:
  //   Low  (< 300 Hz)  : vokal berat, konsonan nasal
  //   Mid  (300–3000 Hz): vokal utama, mayoritas fonem bahasa Inggris
  //   High (> 3000 Hz) : konsonan frikatif (s, sh, f, th)
  //
  // Proxy di domain waktu:
  //   Low  → rata-rata |sample| di 1/8 pertama jika smoothed
  //   Kita gunakan ZCR per segmen sebagai proxy band frekuensi:
  //     ZCR rendah  → energi dominan di frekuensi rendah
  //     ZCR tinggi  → energi dominan di frekuensi tinggi

  // Bagi sampel aktif menjadi 4 kuartal, hitung ZCR tiap kuartal
  const qLen = Math.floor(M / 4);
  let   scEst = 0;
  if (qLen > 0) {
    let totalZCR = 0;
    for (let q = 0; q < 4; q++) {
      let qCross = 0;
      const qStart = q * qLen;
      const qEnd   = (q === 3) ? M : (q + 1) * qLen;
      for (let i = qStart + 1; i < qEnd; i++) {
        if ((activeSamples[i] >= 0) !== (activeSamples[i - 1] >= 0)) qCross++;
      }
      totalZCR += qCross / (qEnd - qStart);
    }
    // Normalisasi ke 0–1 (ZCR maksimum teoritis = 0.5 untuk sinyal AC penuh)
    scEst = Math.min(1, (totalZCR / 4) / 0.5);
  }
  const spectralCentroid = scEst; // Sekarang dalam rentang [0, 1]

  // ── d) Durasi Efektif ─────────────────────────────────────
  const durasiEfektif = M / sr; // durasi bagian aktif saja

  return { rms, zcr, spectralCentroid, durasiEfektif, activeSamples };
}

/* ════════════════════════════════════════════════════════════
   6.  KORELASI SINYAL  —  calculateCorrelation(buf1, buf2)
   ════════════════════════════════════════════════════════════
   Pipeline yang diperbaiki:

   FIX BUG #3 (masalah sinkronisasi):
   Versi lama: downsampling seluruh buffer → korelasi
   Masalah: rekaman 4s vs referensi 0.5s → panjang berbeda jauh,
   sinyal aktif ada di posisi berbeda → korelasi hampir selalu dekat 0.

   Versi baru: downsampling BAGIAN AKTIF saja (sudah diisolasi di
   extractFeatures) → korelasi. Kedua sinyal sekarang sama-sama
   dimulai dari suara pertama, bukan dari hening.

   FIX BUG #4 (scoring tidak adil):
   Versi lama: skor terlalu bergantung pada cross-correlation (bobot 45%)
   yang sangat sensitif terhadap perbedaan mic vs studio .mp3.
   Versi baru: bobot didistribusi ulang — fitur linguistik (ZCR, spektral)
   mendapat porsi lebih besar karena lebih robust terhadap kondisi rekaman.
   ════════════════════════════════════════════════════════════ */

/**
 * Melakukan downsampling Float32Array.
 */
function downsample(samples, factor) {
  const outLen = Math.floor(samples.length / factor);
  const out    = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}

/**
 * Normalisasi sinyal ke rentang [-1, 1].
 */
function normalizeSignal(samples) {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > maxAbs) maxAbs = Math.abs(samples[i]);
  }
  if (maxAbs === 0) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / maxAbs;
  return out;
}

/**
 * Normalized Cross-Correlation antara dua sinyal.
 * FIX: Jika panjang berbeda lebih dari 3x, kompensasi dengan sliding window
 * untuk menemukan posisi terbaik (mencegah skor 0 akibat misalignment).
 *
 * @returns {number} Koefisien korelasi [0.0 – 1.0]
 */
function normalizedCrossCorrelation(a, b) {
  if (a.length === 0 || b.length === 0) return 0;

  // Pastikan 'a' selalu yang lebih pendek (referensi)
  let shorter = a.length <= b.length ? a : b;
  let longer  = a.length <= b.length ? b : a;

  const sLen = shorter.length;
  const lLen = longer.length;

  // Hitung norma shorter sekali saja
  let normShorter = 0;
  for (let i = 0; i < sLen; i++) normShorter += shorter[i] * shorter[i];
  normShorter = Math.sqrt(normShorter);
  if (normShorter === 0) return 0;

  // Sliding: geser shorter di sepanjang longer, cari korelasi terbaik
  // Hanya jika rasio panjang > 1.5x (artinya ada kemungkinan misalignment)
  const step    = lLen > sLen * 1.5 ? Math.floor((lLen - sLen) / 10) : lLen; // max 10 posisi
  let   bestCor = 0;

  for (let offset = 0; offset <= lLen - sLen; offset += Math.max(1, step)) {
    let dot = 0, normLong = 0;
    for (let i = 0; i < sLen; i++) {
      dot      += shorter[i] * longer[offset + i];
      normLong += longer[offset + i] * longer[offset + i];
    }
    normLong = Math.sqrt(normLong);
    const cor = normLong > 0 ? Math.abs(dot / (normShorter * normLong)) : 0;
    if (cor > bestCor) bestCor = cor;
  }

  return Math.min(1, bestCor);
}

/**
 * Membandingkan dua AudioBuffer dan menghasilkan skor kemiripan 0–100.
 *
 * @param   {AudioBuffer} recordedBuffer   - Audio rekaman anak (sudah di-filter)
 * @param   {AudioBuffer} referenceBuffer  - Audio acuan dari file .mp3
 * @returns {{ skorAkhir, skorKorelasi, skorRMS, skorZCR, skorSpektral, skorDurasi, detail }}
 */
function calculateCorrelation(recordedBuffer, referenceBuffer) {
  // ── Ekstraksi fitur BAGIAN AKTIF kedua buffer ────────────
  const featRec = extractFeatures(recordedBuffer);
  const featRef = extractFeatures(referenceBuffer);

  // ── Korelasi PCM pada bagian aktif yang sudah disinkronkan ──
  // FIX: Pakai activeSamples (bukan samples penuh) + DOWNSAMPLE_FACTOR lebih kecil
  // karena bagian aktif sudah pendek, tidak perlu downsample terlalu agresif
  const DOWNSAMPLE_FACTOR = 10; // 44100/10 = 4410 samples/detik — lebih detail
  const recActive  = normalizeSignal(downsample(featRec.activeSamples, DOWNSAMPLE_FACTOR));
  const refActive  = normalizeSignal(downsample(featRef.activeSamples, DOWNSAMPLE_FACTOR));
  const skorKorelasi = normalizedCrossCorrelation(recActive, refActive);

  // ── Perbandingan Fitur Linguistik ────────────────────────

  // a) RMS: kekuatan suara (hanya dari bagian aktif, sudah fair)
  const rmsRatio = featRec.rms > 0 && featRef.rms > 0
    ? Math.min(featRec.rms, featRef.rms) / Math.max(featRec.rms, featRef.rms)
    : 0.5; // Nilai tengah jika salah satu nol
  const skorRMS  = rmsRatio;

  // b) ZCR: karakter konsonan/vokal — robust terhadap kondisi rekaman
  // FIX: Gunakan tolerance ±30% alih-alih rasio murni agar lebih adil
  // (mic berbeda = ZCR bisa beda 10–20% untuk ucapan yang sama)
  const zcrTolerance = 0.8; // ±30%
  const zcrDiff      = Math.abs(featRec.zcr - featRef.zcr);
  const zcrMid       = (featRec.zcr + featRef.zcr) / 2 || 1e-9;
  const zcrRelDiff   = zcrDiff / zcrMid; // relatif terhadap rata-rata
  const skorZCR      = Math.max(0, 1 - (zcrRelDiff / (zcrTolerance * 2)));

  // c) Spectral Centroid: warna suara (sekarang dalam [0,1], perbandingan langsung)
  const scDiff       = Math.abs(featRec.spectralCentroid - featRef.spectralCentroid);
  const skorSpektral = Math.max(0, 1 - scDiff * 2); // Toleransi ±0.5

  // d) Durasi: bandingkan durasi bagian aktif saja (sudah fair)
  // FIX: Gunakan window toleransi ±50% alih-alih rasio murni
  const durRec = featRec.durasiEfektif;
  const durRef = featRef.durasiEfektif;
  let   skorDurasi;
  if (durRec > 0 && durRef > 0) {
    const durRatio = Math.min(durRec, durRef) / Math.max(durRec, durRef);
    // Jika durasi dalam range 0.5x–2x, anggap masih oke → skor > 50%
    skorDurasi = durRatio >= 0.5 ? durRatio : durRatio * 0.5;
  } else {
    skorDurasi = 0.5;
  }

  // ── Agregasi Skor dengan Bobot yang Direvisi ─────────────
  // FIX BUG #4: Bobot lama terlalu besar di korelasi (45%) yang sensitif
  // terhadap kondisi rekaman. Distribusi baru lebih seimbang:
  // ── Agregasi Skor dengan Bobot yang Direvisi ─────────────
  // Turunkan bobot korelasi (karena sangat sensitif terhadap beda mikrofon)
  const BOBOT = {
    korelasi : 0.05, 
    zcr      : 0.35, 
    spektral : 0.35, 
    durasi   : 0.15, 
    rms      : 0.10, 
  };

  // Variabel ini yang sebelumnya tidak sengaja terhapus
  const skorGabungan =
    skorKorelasi * BOBOT.korelasi +
    skorZCR      * BOBOT.zcr      +
    skorSpektral * BOBOT.spektral +
    skorDurasi   * BOBOT.durasi   +
    skorRMS      * BOBOT.rms;

  // --- LOGIKA BOOSTER CERDAS (MENCEGAH KATA BAHASA INDONESIA) ---
  let rawPersen = skorGabungan * 100;
  let skorAkhir;

  // 1. Cek apakah rekaman kosong atau terlalu pendek
  if (featRec.durasiEfektif < 0.2) {
    skorAkhir = Math.floor(Math.random() * 20) + 10; // Skor 10-30
  } else {
    // 2. DETEKSI KATA SALAH ("Kucing" vs "Cat")
    // Jika skor durasi ATAU spektral (warna suara) terlalu rendah dari audio acuan:
    if (skorDurasi < 0.6 || skorSpektral < 0.4) {
      // Aplikasi mendeteksi durasi/pola yang diucapkan berbeda jauh dari aslinya
      skorAkhir = Math.floor(Math.random() * 15) + 40; // Beri skor 40 - 55 (Coba Lagi)
    } 
    // 3. KATA BENAR -> Berikan Booster Motivasi Anak SD
    else {
      // Kurva aman: Angkat nilai ke rentang 75 - 100
      skorAkhir = Math.floor(75 + (rawPersen * 0.8));
      skorAkhir += Math.floor(Math.random() * 5); // Efek acak natural
      if (skorAkhir > 100) skorAkhir = 100;
    }
  }

  // ── PENGEMBALIAN HASIL ─────────────
  const result = {
    skorAkhir,
    skorKorelasi : parseFloat((skorKorelasi * 100).toFixed(1)),
    skorRMS      : parseFloat((skorRMS      * 100).toFixed(1)),
    skorZCR      : parseFloat((skorZCR      * 100).toFixed(1)),
    skorSpektral : parseFloat((skorSpektral * 100).toFixed(1)),
    skorDurasi   : parseFloat((skorDurasi   * 100).toFixed(1)),
    detail: {
      rekaman  : { rms: featRec.rms.toFixed(4), zcr: featRec.zcr.toFixed(4), sc: featRec.spectralCentroid.toFixed(3), durasi: featRec.durasiEfektif.toFixed(2) + 's' },
      referensi: { rms: featRef.rms.toFixed(4), zcr: featRef.zcr.toFixed(4), sc: featRef.spectralCentroid.toFixed(3), durasi: featRef.durasiEfektif.toFixed(2) + 's' },
    },
  };

  console.log('[DSP] Hasil Korelasi:', result);
  return result;
}

/* ════════════════════════════════════════════════════════════
   7.  MUAT AUDIO REFERENSI  —  loadReferenceAudio(url)
   ════════════════════════════════════════════════════════════
   Mengunduh file .mp3 acuan dan mendekodenya menjadi AudioBuffer.
   AudioBuffer yang sudah dimuat di-cache agar tidak perlu fetch ulang.
   ════════════════════════════════════════════════════════════ */

const _audioCache = new Map(); // url → AudioBuffer

/**
 * Memuat file audio dari URL dan mengembalikannya sebagai AudioBuffer.
 * Hasil di-cache berdasarkan URL.
 *
 * @param   {string} url              - Path ke file audio (misal "assets/audio/apple.mp3")
 * @returns {Promise<AudioBuffer>}
 */
async function loadReferenceAudio(url) {
  if (_audioCache.has(url)) {
    console.log(`[DSP] Cache hit: ${url}`);
    return _audioCache.get(url);
  }

  console.log(`[DSP] Memuat audio referensi: ${url}`);
  const response    = await fetch(url);
  if (!response.ok) throw new Error(`[DSP] Gagal fetch ${url}: HTTP ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const ctx         = getAudioContext();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  _audioCache.set(url, audioBuffer);
  console.log(`[DSP] ✓ Audio referensi dimuat: ${audioBuffer.duration.toFixed(2)}s`);
  return audioBuffer;
}

/* ════════════════════════════════════════════════════════════
   8.  FUNGSI UTAMA  —  scorePronunciation(recordedBuffer, referenceUrl)
   ════════════════════════════════════════════════════════════
   Fungsi "orkestrator" yang dipakai oleh index.html / app.js.
   Menerima AudioBuffer hasil rekaman + URL file acuan,
   lalu mengembalikan skor akhir.
   ════════════════════════════════════════════════════════════ */

/**
 * Menilai pengucapan anak dibandingkan audio referensi.
 *
 * @param   {AudioBuffer} recordedBuffer  - Hasil stopRecording()
 * @param   {string}      referenceUrl    - Path ke file .mp3 acuan (dari data.json)
 * @returns {Promise<{skorAkhir: number, ...}>}
 */
async function scorePronunciation(recordedBuffer, referenceUrl) {
  const referenceBuffer = await loadReferenceAudio(referenceUrl);
  return calculateCorrelation(recordedBuffer, referenceBuffer);
}

/* ════════════════════════════════════════════════════════════
   9.  FALLBACK  —  simulateScore(durasiRekaman)
   ════════════════════════════════════════════════════════════
   Dipakai jika file audio referensi belum tersedia (fase dev awal).
   Menghasilkan skor berdasarkan durasi rekaman yang valid:
     - Terlalu pendek (<0.5s)  → anak mungkin tidak bicara → skor rendah
     - Ideal (0.5s – 2.5s)    → skor 70–100
     - Terlalu panjang (>3s)   → mungkin noise → skor dikurangi
   ════════════════════════════════════════════════════════════ */

/**
 * Menghasilkan skor simulasi berdasarkan durasi rekaman.
 * Gunakan ini HANYA saat file audio referensi belum ada.
 *
 * @param   {AudioBuffer} recordedBuffer
 * @returns {{ skorAkhir: number, isSimulasi: true }}
 */
function simulateScore(recordedBuffer) {
  const durasi  = recordedBuffer.duration;  // detik
  const feat    = extractFeatures(recordedBuffer);
  const adaSuara = feat.rms > DSP_CONFIG.SILENCE_THRESHOLD;

  let skor;
  if (!adaSuara || durasi < 0.3) {
    skor = Math.floor(Math.random() * 20) + 10; // 10–30: tidak ada suara
  } else if (durasi < 0.5) {
    skor = Math.floor(Math.random() * 20) + 40; // 40–60: terlalu cepat
  } else if (durasi <= 2.5) {
    skor = Math.floor(Math.random() * 30) + 68; // 68–98: durasi ideal
  } else {
    skor = Math.floor(Math.random() * 25) + 50; // 50–75: terlalu lama
  }

  console.log(`[DSP] Skor simulasi: ${skor} (durasi=${durasi.toFixed(2)}s, rms=${feat.rms.toFixed(4)})`);
  return { skorAkhir: Math.min(100, skor), isSimulasi: true };
}

/* ════════════════════════════════════════════════════════════
   UTILITAS PUBLIK LAINNYA
   ════════════════════════════════════════════════════════════ */

/**
 * Membersihkan resource: hentikan stream mikrofon & tutup AudioContext.
 * Panggil saat pengguna keluar dari halaman kuis.
 */
async function cleanup() {
  if (_mediaStream) {
    _mediaStream.getTracks().forEach(t => t.stop());
    _mediaStream = null;
  }
  if (_audioContext && _audioContext.state !== 'closed') {
    await _audioContext.close();
    _audioContext = null;
  }
  _isRecording  = false;
  _mediaRecorder = null;
  console.log('[DSP] ✓ Resource dibersihkan.');
}

/**
 * Cek apakah browser mendukung semua API yang dibutuhkan.
 *
 * @returns {{ didukung: boolean, detail: object }}
 */
function checkBrowserSupport() {
  const detail = {
    webAudio      : !!(window.AudioContext || window.webkitAudioContext),
    mediaDevices  : !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    mediaRecorder : !!(window.MediaRecorder),
    fetch         : !!(window.fetch),
  };
  const didukung = Object.values(detail).every(Boolean);
  return { didukung, detail };
}

/* ════════════════════════════════════════════════════════════
   EXPORT KE SCOPE GLOBAL
   ════════════════════════════════════════════════════════════ */
window.EngliKidsDSP = {
  // Mikrofon & rekaman
  requestMicrophone,
  startRecording,
  stopRecording,

  // Pemrosesan & penilaian
  calculateCorrelation,
  scorePronunciation,
  simulateScore,

  // Filter (untuk testing langsung)
  createHighPassFilter,
  extractFeatures,

  // Utilitas
  loadReferenceAudio,
  checkBrowserSupport,
  cleanup,
  getAudioContext,
};

/* ════════════════════════════════════════════════════════════
   SELF-TEST  —  Dijalankan saat file pertama kali dimuat
   ════════════════════════════════════════════════════════════ */
(function selfTest() {
  console.groupCollapsed('%c[EngliKids DSP] Self-Test', 'color:#6BCB77;font-weight:bold;');

  // Cek dukungan browser
  const { didukung, detail } = checkBrowserSupport();
  console.log('%c── Dukungan Browser ──', 'color:#4DA8DA;font-weight:bold;');
  Object.entries(detail).forEach(([api, ok]) => {
    console.log(`${ok ? '✓' : '✗'} ${api}: ${ok ? 'Didukung' : 'TIDAK DIDUKUNG'}`);
  });
  if (!didukung) {
    console.warn('[DSP] ⚠ Beberapa API tidak didukung. Fitur DSP mungkin tidak berjalan.');
  }

  // Test fungsi matematika internal (tidak perlu mikrofon)
  console.log('%c── Test Fungsi Internal ──', 'color:#FF6B6B;font-weight:bold;');

  // Test downsample
  const sig      = new Float32Array([1,2,3,4,5,6,7,8,9,10]);
  const ds       = downsample(sig, 2);  // Harus jadi [1.5, 3.5, 5.5, 7.5, 9.5]
  console.assert(ds.length === 5, `✗ downsample: panjang harusnya 5, dapat ${ds.length}`);
  console.assert(Math.abs(ds[0] - 1.5) < 0.001, `✗ downsample: ds[0] harusnya 1.5`);
  console.log('✓ downsample([1..10], 2) =', Array.from(ds).map(v => v.toFixed(1)));

  // Test normalisasi
  const raw      = new Float32Array([0.5, -1.0, 0.25]);
  const norm     = normalizeSignal(raw);
  console.assert(Math.abs(norm[1] - (-1.0)) < 0.001, '✗ normalizeSignal: nilai max harus -1.0');
  console.assert(Math.abs(norm[0] - 0.5) < 0.001, '✗ normalizeSignal: nilai 0.5 harus tetap 0.5');
  console.log('✓ normalizeSignal([0.5,-1.0,0.25]) =', Array.from(norm).map(v => v.toFixed(2)));

  // Test korelasi: sinyal identik → harus mendekati 1.0
  const s1       = new Float32Array([0.1, 0.5, -0.3, 0.8, -0.2]);
  const korelasi = normalizedCrossCorrelation(s1, s1);
  console.assert(Math.abs(korelasi - 1.0) < 0.0001, `✗ Korelasi diri sendiri harus 1.0, dapat ${korelasi}`);
  console.log(`✓ Korelasi(s, s) = ${korelasi.toFixed(4)} (harusnya 1.0000)`);

  // Test korelasi: sinyal nol → harus 0
  const sZero    = new Float32Array(5); // semua nol
  const korZero  = normalizedCrossCorrelation(s1, sZero);
  console.assert(korZero === 0, `✗ Korelasi dengan sinyal nol harus 0`);
  console.log(`✓ Korelasi(s, zeros) = ${korZero} (harusnya 0)`);

  console.log('%c[EngliKids DSP] Self-Test Selesai ✓', 'color:#6BCB77;font-weight:bold;');
  console.groupEnd();
})();