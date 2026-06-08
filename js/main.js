/**
 * ============================================================
 *  EngliKids — main.js  (v2.0)
 *  Mendukung:
 *    - Halaman landing → index (baca profil dari sessionStorage)
 *    - 2 tipe soal: "ucapkan" (speech) dan "cocokkan" (pilihan ganda)
 *    - Voice Transcript real-time via Web Speech API
 *    - DSP Waveform Canvas real-time dari AudioAnalyser
 *    - Integrasi penuh dengan dsp.js & security.js
 * ============================================================
 */

'use strict';

// ─────────────────────────────────────────────
// STATE GLOBAL
// ─────────────────────────────────────────────
let dataSoal        = [];
let indexSoalAktif  = 0;
let skorTotal       = 0;
let uiSedangRekam   = false;
let profilSiswa     = { nama: 'Anak', avatar: '🦉' };

// Web Speech API recognition instance
let speechRecognition = null;
let transkripSementara = '';

// Canvas waveform
let canvasCtx      = null;
let waveformCanvas = null;
let animFrameId    = null;

// DSP analyser node (dipasang saat rekam)
let _analyserNode  = null;

// ─────────────────────────────────────────────
// INISIALISASI
// ─────────────────────────────────────────────
async function init() {
    bacaProfilSiswa();
    await loadDataSoal();
    renderProgressDots();
    tampilkanSoal(indexSoalAktif);
    inisialisasiSpeechRecognition();
    inisialisasiWaveformCanvas();
}

// ─────────────────────────────────────────────
// BACA PROFIL DARI sessionStorage (dari landing.html)
// ─────────────────────────────────────────────
function bacaProfilSiswa() {
    try {
        const raw = sessionStorage.getItem('englikids_profil');
        if (raw) {
            const p = JSON.parse(raw);
            profilSiswa.nama   = p.nama   || 'Anak';
            profilSiswa.avatar = p.avatar || '🦉';
        }
    } catch(e) { /* pakai default */ }

    // Update header UI
    const elNama   = document.getElementById('header-nama');
    const elAvatar = document.getElementById('header-avatar');
    if (elNama)   elNama.textContent   = profilSiswa.nama;
    if (elAvatar) elAvatar.textContent = profilSiswa.avatar;
}

// ─────────────────────────────────────────────
// LOAD DATA DARI data.json
// ─────────────────────────────────────────────
async function loadDataSoal() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();

        const warnaPerKategori = {
            buah    : 'linear-gradient(90deg,#FF6B6B,#FFA07A)',
            hewan   : 'linear-gradient(90deg,#6BCB77,#4DA8DA)',
            warna   : 'linear-gradient(90deg,#A06CD5,#4DA8DA)',
            angka   : 'linear-gradient(90deg,#4DA8DA,#FFD93D)',
            benda   : 'linear-gradient(90deg,#FFD93D,#FFA07A)',
            perasaan: 'linear-gradient(90deg,#FF6B6B,#A06CD5)',
            alam    : 'linear-gradient(90deg,#6BCB77,#FFD93D)',
        };

        dataSoal = json.soal.map(soal => ({
            ...soal,
            warnaBadge: warnaPerKategori[soal.kategori?.toLowerCase()]
                        || 'linear-gradient(90deg,#A06CD5,#FF6B6B)',
        }));

        console.log(`[App] ✓ ${dataSoal.length} soal dimuat.`);
    } catch (err) {
        console.error('[App] Gagal memuat data.json:', err);
        tampilkanToast('⚠️ Gagal memuat soal. Jalankan lewat server lokal.', '#FF6B6B', 5000);
    }
}

// ─────────────────────────────────────────────
// PROGRESS DOTS
// ─────────────────────────────────────────────
function renderProgressDots() {
    const container = document.getElementById('progress-dots');
    if (!container) return;
    container.innerHTML = '';
    dataSoal.forEach((soal, i) => {
        const dot = document.createElement('div');
        // Warna berbeda untuk tipe soal berbeda
        const isCocokkan = soal.tipe === 'cocokkan';
        dot.className = `w-3 h-3 rounded-full transition-all duration-300 `;
        if (i === indexSoalAktif)    dot.className += 'dot-active';
        else if (i < indexSoalAktif) dot.className += 'dot-done';
        else                          dot.className += 'dot-inactive';

        // Shape berbeda untuk tipe cocokkan
        if (isCocokkan) dot.style.borderRadius = '4px';
        container.appendChild(dot);
    });
    const el = document.getElementById('label-nomor-soal');
    if (el) el.textContent = `${indexSoalAktif + 1} / ${dataSoal.length}`;
    
    // Update skor live
    const elSkor = document.getElementById('skor-live');
    if (elSkor) elSkor.textContent = skorTotal;
}

// ─────────────────────────────────────────────
// TAMPILKAN SOAL — dispatch berdasarkan tipe
// ─────────────────────────────────────────────
function tampilkanSoal(idx) {
    const soal = dataSoal[idx];
    if (!soal) { tampilkanModalSkor(); return; }

    resetVoiceTranscript();

    if (soal.tipe === 'cocokkan') {
        tampilkanSoalCocokkan(soal);
    } else {
        tampilkanSoalUcapkan(soal);
    }

    renderProgressDots();
    animasiMasukKartu();
}

// ── Soal tipe UCAPKAN ────────────────────────
function tampilkanSoalUcapkan(soal) {
    document.getElementById('section-ucapkan').classList.remove('hidden');
    document.getElementById('section-cocokkan').classList.add('hidden');

    const gambarEl = document.getElementById('gambar-soal');
    const emojiEl  = document.getElementById('emoji-soal');

    if (soal.gambar) {
        gambarEl.src         = soal.gambar;
        gambarEl.alt         = soal.kata;
        gambarEl.classList.remove('hidden');
        emojiEl.classList.add('hidden');
    } else if (soal.emoji) {
        emojiEl.textContent = soal.emoji;
        emojiEl.classList.remove('hidden');
        gambarEl.classList.add('hidden');
    }

    document.getElementById('teks-kata').textContent        = soal.kata;
    document.getElementById('teks-terjemahan').textContent  = `(${soal.terjemahan})`;
    document.getElementById('badge-kategori').textContent   = soal.kategori?.toUpperCase() || '';
    document.getElementById('badge-kategori').style.background = soal.warnaBadge;

    resetInstruksi();
}

// ── Soal tipe COCOKKAN ───────────────────────
function tampilkanSoalCocokkan(soal) {
    document.getElementById('section-ucapkan').classList.add('hidden');
    document.getElementById('section-cocokkan').classList.remove('hidden');

    document.getElementById('cocokkan-kata').textContent      = soal.kata;
    document.getElementById('badge-cocokkan').style.background = soal.warnaBadge;
    document.getElementById('feedback-cocokkan').classList.add('hidden');

    // Gambar atau emoji
    const gambarEl  = document.getElementById('cocokkan-gambar');
    const emojiEl   = document.getElementById('cocokkan-emoji');
    if (soal.gambar) {
        gambarEl.src = soal.gambar;
        gambarEl.classList.remove('hidden');
        emojiEl.classList.add('hidden');
    } else if (soal.emoji) {
        emojiEl.textContent = soal.emoji;
        emojiEl.classList.remove('hidden');
        gambarEl.classList.add('hidden');
    }

    // Render pilihan ganda — acak urutan
    const container = document.getElementById('container-pilihan');
    container.innerHTML = '';
    const pilihanAcak = [...soal.pilihan].sort(() => Math.random() - 0.5);

    pilihanAcak.forEach((pilihan, i) => {
        const btn = document.createElement('button');
        btn.className = 'pilihan-btn';
        btn.innerHTML = `<span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-800 flex-shrink-0"
                              style="background:linear-gradient(135deg,#4DA8DA,#A06CD5);color:white;">
                            ${String.fromCharCode(65 + i)}
                         </span>
                         <span>${pilihan}</span>`;
        btn.onclick = () => handlePilihJawaban(btn, pilihan, soal.terjemahan_benar, soal);
        container.appendChild(btn);
    });
}

// ─────────────────────────────────────────────
// HANDLER PILIH JAWABAN (COCOKKAN)
// ─────────────────────────────────────────────
function handlePilihJawaban(btn, pilihanUser, jawabanBenar, soal) {
    // Nonaktifkan semua tombol
    document.querySelectorAll('.pilihan-btn').forEach(b => b.disabled = true);

    const benar = pilihanUser === jawabanBenar;
    const poin  = benar ? 100 : 30;
    skorTotal  += poin;

    if (benar) {
        btn.classList.add('benar');
        tampilkanFeedbackCocokkan(`✅ Benar! "${soal.kata}" = "${jawabanBenar}" (+${poin} poin)`, '#6BCB77');
        tampilkanToast(`🎉 Hebat! Jawaban benar! +${poin} poin`, '#6BCB77', 1800);
    } else {
        btn.classList.add('salah');
        // Tandai jawaban yang benar
        document.querySelectorAll('.pilihan-btn').forEach(b => {
            if (b.querySelector('span:last-child')?.textContent === jawabanBenar) {
                b.classList.add('benar');
            }
        });
        tampilkanFeedbackCocokkan(`❌ Jawaban benar: "${jawabanBenar}" (+${poin} poin)`, '#FF6B6B');
        tampilkanToast(`💪 Hampir! Jawaban benar: ${jawabanBenar}`, '#FFA07A', 2000);
    }

    setTimeout(() => {
        indexSoalAktif++;
        if (indexSoalAktif < dataSoal.length) {
            tampilkanSoal(indexSoalAktif);
        } else {
            tampilkanModalSkor();
        }
    }, 2200);
}

function tampilkanFeedbackCocokkan(pesan, warna) {
    const el = document.getElementById('feedback-cocokkan');
    el.textContent   = pesan;
    el.style.background = warna;
    el.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// DENGARKAN AUDIO
// ─────────────────────────────────────────────
function handleDengarkan() {
    const soal = dataSoal[indexSoalAktif];
    tampilkanToast(`🔊 Mendengarkan "${soal.kata}"...`, '#4DA8DA');
    const btn = document.getElementById('btn-dengar');
    if (btn) { btn.classList.add('scale-95'); setTimeout(() => btn.classList.remove('scale-95'), 200); }

    const audio = new Audio(soal.audio_referensi);
    audio.play().catch(() => {
        if ('speechSynthesis' in window) {
            const utt  = new SpeechSynthesisUtterance(soal.kata);
            utt.lang   = 'en-US'; utt.rate = 0.85; utt.pitch = 1.1;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utt);
        }
    });
}

// ─────────────────────────────────────────────
// SPEECH RECOGNITION — Voice Transcript
// ─────────────────────────────────────────────
function inisialisasiSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        console.warn('[App] Speech Recognition tidak didukung browser ini.');
        return;
    }

    speechRecognition = new SR();
    speechRecognition.lang            = 'en-US';
    speechRecognition.interimResults  = true;   // Hasil sementara real-time
    speechRecognition.continuous      = false;
    speechRecognition.maxAlternatives = 3;

    speechRecognition.onstart = () => {
        console.log('[SR] 🎤 Speech recognition dimulai.');
        tampilkanVoiceTranscript('...', false);
    };

    speechRecognition.onresult = (event) => {
        let transkripFinal    = '';
        let transkripSementaraUI = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const teks = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                transkripFinal += teks;
            } else {
                transkripSementaraUI += teks;
            }
        }

        const tampilkan = transkripFinal || transkripSementaraUI;
        transkripSementara = transkripFinal || transkripSementaraUI;
        tampilkanVoiceTranscript(tampilkan, !!transkripFinal);

        if (transkripFinal) {
            // Cek kesesuaian dengan soal
            const soal    = dataSoal[indexSoalAktif];
            const targetKata = soal?.kata?.toLowerCase().trim() || '';
            const ucapkan    = transkripFinal.toLowerCase().trim();
            const cocok      = ucapkan.includes(targetKata) || targetKata.includes(ucapkan) ||
                               hitungSimilaritas(ucapkan, targetKata) > 0.65;
            tampilkanMatchTranscript(cocok, soal?.kata || '');
        }
    };

    speechRecognition.onerror = (event) => {
        console.warn('[SR] Error:', event.error);
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            tampilkanVoiceTranscript(`⚠️ ${event.error}`, false);
        }
    };

    speechRecognition.onend = () => {
        console.log('[SR] 🔇 Speech recognition selesai.');
    };
}

// Hitung similaritas Jaro-Winkler sederhana
function hitungSimilaritas(s1, s2) {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLen = longer.length;
    if (longerLen === 0) return 1;
    const editDist = levenshteinDistance(longer, shorter);
    return (longerLen - editDist) / longerLen;
}

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i-1] === s2[j-1]) dp[i][j] = dp[i-1][j-1];
            else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
    }
    return dp[m][n];
}

// Tampilkan transcript di UI
function tampilkanVoiceTranscript(teks, isFinal) {
    const container = document.getElementById('voice-transcript');
    const textEl    = document.getElementById('transcript-text');
    if (!container || !textEl) return;
    container.classList.remove('hidden');
    textEl.textContent = `"${teks}"`;
    textEl.style.color = isFinal ? '#1f2937' : '#9ca3af';
}

function tampilkanMatchTranscript(cocok, kataSoal) {
    const matchDiv = document.getElementById('transcript-match');
    const iconEl   = document.getElementById('match-icon');
    const textEl   = document.getElementById('match-text');
    if (!matchDiv || !iconEl || !textEl) return;
    matchDiv.classList.remove('hidden');
    if (cocok) {
        iconEl.textContent = '✅';
        textEl.textContent = `Pengucapan "${kataSoal}" terdeteksi dengan baik!`;
        textEl.style.color = '#166534';
    } else {
        iconEl.textContent = '🔄';
        textEl.textContent = `Coba ucapkan "${kataSoal}" dengan jelas.`;
        textEl.style.color = '#92400e';
    }
}

function resetVoiceTranscript() {
    const container = document.getElementById('voice-transcript');
    const matchDiv  = document.getElementById('transcript-match');
    if (container)  container.classList.add('hidden');
    if (matchDiv)   matchDiv.classList.add('hidden');
    transkripSementara = '';
}

// ─────────────────────────────────────────────
// DSP WAVEFORM CANVAS — real-time visualisasi
// ─────────────────────────────────────────────
function inisialisasiWaveformCanvas() {
    waveformCanvas = document.getElementById('waveform-canvas');
    if (!waveformCanvas) return;
    canvasCtx = waveformCanvas.getContext('2d');
}

// Mulai render waveform dari AnalyserNode DSP
function mulaiRenderWaveform(analyserNode) {
    if (!canvasCtx || !waveformCanvas) return;
    _analyserNode = analyserNode;
    waveformCanvas.classList.add('active');
    document.getElementById('waveform-bars')?.classList.add('hidden');
    renderLoopWaveform();
}

function renderLoopWaveform() {
    if (!_analyserNode || !canvasCtx) return;

    const bufferLen  = _analyserNode.frequencyBinCount;
    const dataArray  = new Uint8Array(bufferLen);
    _analyserNode.getByteTimeDomainData(dataArray);

    const W = waveformCanvas.width;
    const H = waveformCanvas.height;

    canvasCtx.clearRect(0, 0, W, H);

    // Background gradient
    const grad = canvasCtx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(255,107,107,0.08)');
    grad.addColorStop(0.5, 'rgba(77,168,218,0.12)');
    grad.addColorStop(1,   'rgba(160,108,213,0.08)');
    canvasCtx.fillStyle = grad;
    canvasCtx.fillRect(0, 0, W, H);

    // Waveform line
    canvasCtx.lineWidth   = 2.5;
    canvasCtx.strokeStyle = '#FF6B6B';
    canvasCtx.shadowColor = '#FF6B6B';
    canvasCtx.shadowBlur  = 6;
    canvasCtx.beginPath();

    const sliceWidth = W / bufferLen;
    let x = 0;
    for (let i = 0; i < bufferLen; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * H) / 2;
        if (i === 0) canvasCtx.moveTo(x, y);
        else         canvasCtx.lineTo(x, y);
        x += sliceWidth;
    }
    canvasCtx.lineTo(W, H / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;

    animFrameId = requestAnimationFrame(renderLoopWaveform);
}

function berhentiRenderWaveform() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    _analyserNode = null;
    if (waveformCanvas) waveformCanvas.classList.remove('active');
    if (canvasCtx && waveformCanvas) {
        canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
}

// ─────────────────────────────────────────────
// TOMBOL MIKROFON
// ─────────────────────────────────────────────
async function handleMic() {
    if (!uiSedangRekam) await mulaiRekam();
    else                await stopRekam();
}

async function mulaiRekam() {
    if (uiSedangRekam) return;

    try {
        // Buat AudioContext & Analyser untuk waveform canvas
        const ctx      = EngliKidsDSP.getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;

        await EngliKidsDSP.startRecording({
            maxDuration   : 4000,
            onVolumeUpdate: (rms) => {
                // Update CSS wave bars (fallback)
                const bars = document.querySelectorAll('.wave-bar');
                bars.forEach((bar, i) => {
                    const tinggi = Math.max(6, Math.round(rms * 60) + (i % 2 === 0 ? 4 : 8));
                    bar.style.height = tinggi + 'px';
                });
            },
        });

        // Hubungkan analyser ke audio context untuk waveform canvas
        // (EngliKidsDSP sudah membuat analyser internal; kita buat yang terpisah untuk UI)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);
            mulaiRenderWaveform(analyser);
            // Simpan stream untuk dihentikan nanti
            window._uiStream = stream;
        } catch(e) {
            console.warn('[App] UI analyser gagal, pakai CSS bars:', e);
            document.getElementById('waveform-bars')?.classList.remove('hidden');
            document.getElementById('waveform-bars')?.classList.add('flex');
        }

        uiSedangRekam = true;
        document.getElementById('btn-mic')?.classList.add('recording');
        document.getElementById('teks-instruksi').textContent = '🎙️ Sedang merekam... ucapkan kata-nya!';
        document.getElementById('teks-instruksi').style.color = '#FF6B6B';

        // Mulai Speech Recognition bersamaan
        if (speechRecognition) {
            try { speechRecognition.start(); } catch(e) {}
        }

        setTimeout(async () => {
            if (uiSedangRekam) await stopRekam();
        }, 4500);

    } catch (err) {
        tampilkanToast(`❌ ${err.message}`, '#FF6B6B');
        uiSedangRekam = false;
    }
}

async function stopRekam() {
    if (!uiSedangRekam) return;
    uiSedangRekam = false;

    document.getElementById('btn-mic')?.classList.remove('recording');
    berhentiRenderWaveform();
    document.getElementById('waveform-bars')?.classList.add('hidden');
    document.getElementById('teks-instruksi').textContent = '⏳ Menganalisa suaramu...';
    document.getElementById('teks-instruksi').style.color = '#A06CD5';

    // Hentikan UI stream jika ada
    if (window._uiStream) {
        window._uiStream.getTracks().forEach(t => t.stop());
        window._uiStream = null;
    }

    // Hentikan speech recognition
    if (speechRecognition) {
        try { speechRecognition.stop(); } catch(e) {}
    }

    try {
        const audioBuffer = await EngliKidsDSP.stopRecording();
        window._lastRecordedBuffer = audioBuffer;
        await prosesAudio();
    } catch (err) {
        if (err.message?.includes('Tidak ada rekaman')) {
            if (window._lastRecordedBuffer) await prosesAudio();
            else {
                setTimeout(async () => {
                    if (window._lastRecordedBuffer) await prosesAudio();
                    else {
                        tampilkanToast('⚠️ Rekaman terlalu pendek, coba lagi!', '#FFA07A');
                        resetInstruksi();
                    }
                }, 500);
            }
        } else {
            tampilkanToast('⚠️ Rekaman gagal diproses.', '#FFA07A');
            resetInstruksi();
        }
    }
}

// ─────────────────────────────────────────────
// PROSES AUDIO — DSP scoring
// ─────────────────────────────────────────────
async function prosesAudio() {
    if (!window._lastRecordedBuffer) {
        tampilkanToast('❌ Tidak ada data audio.', '#FF6B6B');
        resetInstruksi(); return;
    }

    const soal = dataSoal[indexSoalAktif];
    try {
        let hasil;
        try {
            const probe = await fetch(soal.audio_referensi, { method: 'HEAD' });
            if (probe.ok) {
                hasil = await EngliKidsDSP.scorePronunciation(window._lastRecordedBuffer, soal.audio_referensi);
            } else throw new Error('File referensi tidak ditemukan.');
        } catch(_) {
            hasil = EngliKidsDSP.simulateScore(window._lastRecordedBuffer);
        }

        // Gabungkan skor DSP + kecocokan Speech Recognition
        let skorFinal = hasil.skorAkhir;
        if (transkripSementara) {
            const targetKata  = soal.kata?.toLowerCase().trim() || '';
            const transkripLower = transkripSementara.toLowerCase().trim();
            const cocok = transkripLower.includes(targetKata) ||
                          hitungSimilaritas(transkripLower, targetKata) > 0.65;
            if (cocok && skorFinal < 75)  skorFinal = Math.min(100, skorFinal + 15);
            if (!cocok && skorFinal > 70) skorFinal = Math.max(40, skorFinal - 10);
        }

        tampilkanHasilSkorUcapkan(skorFinal, soal);
    } catch (err) {
        tampilkanToast('⚠️ Gagal menganalisis suara.', '#FFA07A');
        resetInstruksi();
    } finally {
        window._lastRecordedBuffer = null;
    }
}

// ─────────────────────────────────────────────
// TAMPILKAN HASIL SKOR SOAL UCAPKAN
// ─────────────────────────────────────────────
function tampilkanHasilSkorUcapkan(skor, soal) {
    const poin = Math.round((skor / 100) * 100);
    skorTotal += poin;

    let pesan, warna;
    if (skor >= 90)      { pesan = `🌟 Sempurna! "${soal.kata}" benar sekali!`;          warna = '#6BCB77'; }
    else if (skor >= 70) { pesan = `👍 Bagus! Hampir sempurna! (+${poin} poin)`;          warna = '#4DA8DA'; }
    else                 { pesan = `💪 Terus berlatih! Kamu pasti bisa! (+${poin} poin)`; warna = '#FFA07A'; }

    tampilkanToast(`${pesan}`, warna, 2500);

    setTimeout(() => {
        indexSoalAktif++;
        if (indexSoalAktif < dataSoal.length) tampilkanSoal(indexSoalAktif);
        else                                   tampilkanModalSkor();
    }, 2800);
}

// ─────────────────────────────────────────────
// LEWATI
// ─────────────────────────────────────────────
function handleLewati() {
    tampilkanToast('⏭️ Soal dilewati...', '#FFA07A');
    berhentiRenderWaveform();
    if (speechRecognition) { try { speechRecognition.stop(); } catch(e) {} }
    setTimeout(() => {
        indexSoalAktif++;
        if (indexSoalAktif < dataSoal.length) tampilkanSoal(indexSoalAktif);
        else                                   tampilkanModalSkor();
    }, 800);
}

// ─────────────────────────────────────────────
// MODAL SKOR AKHIR
// ─────────────────────────────────────────────
function tampilkanModalSkor() {
    const modal      = document.getElementById('modal-skor');
    const soalUcapkan = dataSoal.filter(s => s.tipe === 'ucapkan').length;
    const soalCocokkan= dataSoal.filter(s => s.tipe === 'cocokkan').length;
    const maxSkor    = (soalUcapkan * 100) + (soalCocokkan * 100);
    const persentase = maxSkor > 0 ? (skorTotal / maxSkor) * 100 : 0;

    // Tampilkan avatar siswa di modal
    const avatarEl = document.getElementById('modal-avatar');
    if (avatarEl) avatarEl.textContent = persentase >= 90 ? '🏆' : persentase >= 60 ? '😊' : '💪';

    document.getElementById('skor-angka').textContent = skorTotal;
    const skorDariEl = document.getElementById('skor-dari');
    if (skorDariEl) skorDariEl.textContent = `dari ${maxSkor} poin`;

    let pesan, jumlahBintang;
    if (persentase >= 90)      { pesan = '🏆 Luar biasa! Kamu bintang Bahasa Inggris!'; jumlahBintang = 3; }
    else if (persentase >= 60) { pesan = '🚀 Keren! Hampir sempurna, terus semangat!';  jumlahBintang = 2; }
    else                       { pesan = '💪 Jangan menyerah! Latihan terus ya, Champ!'; jumlahBintang = 1; }

    document.getElementById('pesan-motivasi').textContent = pesan;
    modal.classList.remove('hidden');

    simpanSkor(profilSiswa.nama);

    for (let i = 1; i <= 3; i++) {
        const star = document.getElementById(`star-${i}`);
        if (!star) continue;
        star.classList.remove('active');
        if (i <= jumlahBintang) setTimeout(() => star.classList.add('active'), i * 300);
    }

    setTimeout(tembakKonfeti, 400);
}

// ─────────────────────────────────────────────
// KONFETI
// ─────────────────────────────────────────────
const warnasKonfeti = ['#FFD93D','#FF6B6B','#6BCB77','#4DA8DA','#A06CD5','#FFA07A'];
function tembakKonfeti() {
    const container = document.getElementById('konfeti-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 30; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left             = Math.random() * 100 + '%';
        piece.style.top              = '-10px';
        piece.style.background       = warnasKonfeti[Math.floor(Math.random() * warnasKonfeti.length)];
        piece.style.animationDelay   = Math.random() * 0.8 + 's';
        piece.style.animationDuration = (1.2 + Math.random() * 1) + 's';
        piece.style.borderRadius     = Math.random() > 0.5 ? '50%' : '2px';
        container.appendChild(piece);
    }
}

// ─────────────────────────────────────────────
// TOMBOL MODAL
// ─────────────────────────────────────────────
function handleMainLagi() {
    indexSoalAktif = 0;
    skorTotal      = 0;
    document.getElementById('modal-skor').classList.add('hidden');
    resetVoiceTranscript();
    tampilkanSoal(0);
    tampilkanToast('🎮 Permainan dimulai lagi!', '#FF6B6B');
}

function handleLihatRiwayat() {
    const riwayat = JSON.parse(localStorage.getItem('englikids_riwayat') || '[]');
    if (riwayat.length === 0) {
        tampilkanToast('📊 Belum ada riwayat skor.', '#A06CD5', 2000);
        return;
    }

    const riwayatDiv  = document.getElementById('riwayat-mini');
    const riwayatList = document.getElementById('riwayat-list');
    riwayatDiv?.classList.remove('hidden');

    const tail = riwayat.slice(-3).reverse();
    riwayatList.innerHTML = tail.map(r =>
        `<div class="flex justify-between items-center text-xs font-nunito font-700 text-gray-600">
            <span>${r.namaDisplay || 'Anonim'}</span>
            <span style="color:#6BCB77;">${r.skor} poin</span>
            <span class="text-gray-400">${new Date(r.tanggal).toLocaleDateString('id-ID')}</span>
         </div>`
    ).join('');
}

// ─────────────────────────────────────────────
// SIMPAN SKOR — SHA-256 + RLE (security.js)
// ─────────────────────────────────────────────
async function simpanSkor(namaUser = 'Anonim') {
    try {
        const { hashPassword, compressRLE, getCompressionRatio } = EngliKidsSecurity;

        const namaHash       = await hashPassword(namaUser + '_englikids_salt');
        const tanggal        = new Date().toISOString();
        const detailSoal     = dataSoal.map(s => s.kata).join('|');
        const stringSesi     = `${namaUser}|${skorTotal}|${tanggal}|${detailSoal}`;
        const sesiTerkompresi = compressRLE(stringSesi);
        const rasio           = getCompressionRatio(stringSesi, sesiTerkompresi);

        console.log(`[App] Kompresi RLE: ${rasio.originalLen}→${rasio.compressedLen} char, ${rasio.ratio}`);

        const sesiData = {
            namaHash      : namaHash.slice(0, 16) + '...',
            namaDisplay   : namaUser,
            avatar        : profilSiswa.avatar,
            skor          : skorTotal,
            maxSkor       : dataSoal.length * 100,
            tanggal,
            sesiTerkompresi,
            kompresiRasio : rasio.ratio,
        };

        const KEY_RIWAYAT = 'englikids_riwayat';
        const riwayatLama = JSON.parse(localStorage.getItem(KEY_RIWAYAT) || '[]');
        riwayatLama.push(sesiData);
        if (riwayatLama.length > 20) riwayatLama.shift();
        localStorage.setItem(KEY_RIWAYAT, JSON.stringify(riwayatLama));

        console.log('[App] ✓ Skor tersimpan:', sesiData);
        tampilkanToast('💾 Skor tersimpan!', '#6BCB77', 1500);
        return sesiData;
    } catch (err) {
        console.error('[App] Gagal menyimpan skor:', err);
    }
}

// ─────────────────────────────────────────────
// UI UTILS
// ─────────────────────────────────────────────
let toastTimeout = null;
function tampilkanToast(pesan, warna = '#6BCB77', durasi = 2000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = pesan;
    toast.style.background = warna;
    toast.style.opacity = '1';
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, durasi);
}

function resetInstruksi() {
    const el = document.getElementById('teks-instruksi');
    if (el) { el.textContent = 'Tekan tombol di bawah, lalu ucapkan kata tersebut! 🎙️'; el.style.color = ''; }
}

function animasiMasukKartu() {
    const cards = [document.getElementById('card-gambar'),
                   document.querySelector('.soal-section:not(.hidden)')];
    cards.forEach(card => {
        if (!card) return;
        card.style.opacity   = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            card.style.opacity    = '1';
            card.style.transform  = '';
        }, 50);
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────
// MULAI
// ─────────────────────────────────────────────
init();
