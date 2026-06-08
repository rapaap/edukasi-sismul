/**
 * ============================================================
 *  EngliKids — main.js  (v3.0)
 *
 *  Fitur baru v3.0:
 *    - Tipe soal ke-3: "scramble" (susun huruf)
 *    - Sistem Level & XP (persistent di localStorage)
 *    - Streak harian (persistent di localStorage)
 *    - Power-ups: Hint, Skip Gratis, 2× XP, 50:50
 *    - Mode Kilat (8 soal acak) & Mode Tantangan (timer)
 *    - Sound Effect via Web Audio API (tanpa file tambahan)
 *    - Level Up Banner animasi
 *    - Leaderboard di modal skor akhir
 *    - XP float animation saat benar
 * ============================================================
 */

'use strict';

// ─────────────────────────────────────────────
// STATE GLOBAL
// ─────────────────────────────────────────────
let dataSoalSemua   = [];   // Semua soal dari data.json
let dataSoal        = [];   // Soal yang aktif dimainkan (bisa subset)
let indexSoalAktif  = 0;
let skorTotal       = 0;
let xpSesiIni       = 0;
let uiSedangRekam   = false;
let profilSiswa     = { nama: 'Anak', avatar: '🦉', mode: 'normal' };

// Speech Recognition
let speechRecognition  = null;
let transkripSementara = '';

// Canvas waveform
let canvasCtx      = null;
let waveformCanvas = null;
let animFrameId    = null;
let _analyserNode  = null;

// Timer (mode tantangan)
let timerInterval  = null;
let timerSisa      = 60;
const TIMER_TOTAL  = 60;

// Power-ups (stok per sesi)
let powerUps = { hint: 1, skipGratis: 2, doubleXP: 1, fiftyFifty: 1 };
let doubleXPAktif = false;

// Scramble state
let scrambleJawaban = [];   // huruf yang sudah dimasukkan user
let scrambleKata    = '';   // kata target (uppercase)

// ─────────────────────────────────────────────
// INISIALISASI
// ─────────────────────────────────────────────
async function init() {
    bacaProfilSiswa();
    await loadDataSoal();
    siapkanSoalSesuaiMode();
    renderProgressDots();
    tampilkanSoal(indexSoalAktif);
    inisialisasiSpeechRecognition();
    inisialisasiWaveformCanvas();
    updateHeaderXP();
    updatePowerUpsUI();
    if (profilSiswa.mode === 'tantangan') mulaiTimer();
}

// ─────────────────────────────────────────────
// BACA PROFIL DARI sessionStorage
// ─────────────────────────────────────────────
function bacaProfilSiswa() {
    try {
        const raw = sessionStorage.getItem('englikids_profil');
        if (raw) {
            const p = JSON.parse(raw);
            profilSiswa.nama   = p.nama   || 'Anak';
            profilSiswa.avatar = p.avatar || '🦉';
            profilSiswa.mode   = p.mode   || 'normal';
        }
    } catch(e) {}

    const elNama   = document.getElementById('header-nama');
    const elAvatar = document.getElementById('header-avatar');
    if (elNama)   elNama.textContent   = profilSiswa.nama;
    if (elAvatar) elAvatar.textContent = profilSiswa.avatar;

    // Tampilkan mode badge
    const modeBadge = document.getElementById('mode-badge');
    if (modeBadge && profilSiswa.mode !== 'normal') {
        modeBadge.classList.remove('hidden');
        const labels = { kilat: '⚡ KILAT', tantangan: '🔥 TANTANGAN' };
        modeBadge.textContent = labels[profilSiswa.mode] || profilSiswa.mode.toUpperCase();
    }

    // Streak di header
    const streak = hitungStreak();
    const elStreak = document.getElementById('header-streak');
    if (elStreak) elStreak.textContent = streak + ' hari';
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
            tempat  : 'linear-gradient(90deg,#4DA8DA,#6BCB77)',
        };

        dataSoalSemua = json.soal.map(soal => ({
            ...soal,
            warnaBadge: warnaPerKategori[soal.kategori?.toLowerCase()]
                        || 'linear-gradient(90deg,#A06CD5,#FF6B6B)',
        }));

        console.log(`[App] ✓ ${dataSoalSemua.length} soal dimuat.`);
    } catch (err) {
        console.error('[App] Gagal memuat data.json:', err);
        tampilkanToast('⚠️ Gagal memuat soal. Jalankan lewat server lokal.', '#FF6B6B', 5000);
    }
}

// ─────────────────────────────────────────────
// SIAPKAN SOAL SESUAI MODE
// ─────────────────────────────────────────────
function siapkanSoalSesuaiMode() {
    if (profilSiswa.mode === 'kilat') {
        // 8 soal acak
        const acak = [...dataSoalSemua].sort(() => Math.random() - 0.5);
        dataSoal = acak.slice(0, 8);
    } else {
        dataSoal = [...dataSoalSemua];
    }
}

// ─────────────────────────────────────────────
// SISTEM LEVEL & XP
// ─────────────────────────────────────────────
function xpUntukLevel(lvl) { return lvl * 80; }

function hitungLevel(totalXP) {
    let lvl = 1, xp = totalXP;
    while (xp >= xpUntukLevel(lvl)) {
        xp -= xpUntukLevel(lvl); lvl++;
        if (lvl > 99) break;
    }
    return { level: lvl, xpSaatIni: xp, xpButuh: xpUntukLevel(lvl) };
}

function tambahXP(jumlah) {
    const jumlahFinal = doubleXPAktif ? jumlah * 2 : jumlah;
    xpSesiIni += jumlahFinal;

    const totalLama  = parseInt(localStorage.getItem('englikids_totalxp') || '0');
    const totalBaru  = totalLama + jumlahFinal;
    localStorage.setItem('englikids_totalxp', totalBaru);

    // Cek level up
    const infoBaru = hitungLevel(totalBaru);
    const infoLama = hitungLevel(totalLama);
    if (infoBaru.level > infoLama.level) tampilkanLevelUp(infoBaru.level);

    updateHeaderXP();
    animasiXPFloat(jumlahFinal);
    return jumlahFinal;
}

function updateHeaderXP() {
    const totalXP = parseInt(localStorage.getItem('englikids_totalxp') || '0');
    const { level, xpSaatIni, xpButuh } = hitungLevel(totalXP);
    const elLevel = document.getElementById('header-level');
    const elBar   = document.getElementById('header-xp-bar');
    if (elLevel) elLevel.textContent = `Lvl ${level}`;
    if (elBar)   elBar.style.width = Math.min(100, (xpSaatIni / xpButuh) * 100) + '%';
}

function tampilkanLevelUp(level) {
    const banner = document.getElementById('level-up-banner');
    const text   = document.getElementById('level-up-text');
    if (!banner) return;
    text.textContent = `Level ${level} tercapai! 🎉`;
    banner.style.display = 'block';
    playSoundEffect('levelup');
    setTimeout(() => { banner.style.display = 'none'; }, 3000);
}

function animasiXPFloat(jumlah) {
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = `+${jumlah} XP`;
    el.style.left = (40 + Math.random() * 20) + '%';
    el.style.top  = '15%';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
}

// ─────────────────────────────────────────────
// STREAK HARIAN
// ─────────────────────────────────────────────
function hitungStreak() {
    const raw = localStorage.getItem('englikids_streak');
    if (!raw) return 0;
    try {
        const d       = JSON.parse(raw);
        const today   = new Date().toDateString();
        const kemarin = new Date(Date.now() - 86400000).toDateString();
        if (d.lastDate === today)   return d.count;
        if (d.lastDate === kemarin) return d.count;
        return 0;
    } catch { return 0; }
}

function perbaruiStreak() {
    const today   = new Date().toDateString();
    const kemarin = new Date(Date.now() - 86400000).toDateString();
    let streak = { count: 1, lastDate: today };
    try {
        const raw = localStorage.getItem('englikids_streak');
        if (raw) {
            const d = JSON.parse(raw);
            if (d.lastDate === today) {
                streak = d; // sudah update hari ini
            } else if (d.lastDate === kemarin) {
                streak = { count: d.count + 1, lastDate: today };
            }
        }
    } catch {}
    localStorage.setItem('englikids_streak', JSON.stringify(streak));
}

// ─────────────────────────────────────────────
// SOUND EFFECTS (Web Audio API — tanpa file)
// ─────────────────────────────────────────────
function playSoundEffect(tipe) {
    try {
        const ctx = EngliKidsDSP.getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;

        if (tipe === 'benar') {
            // Nada naik ceria
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(550, now + 0.1);
            osc.frequency.setValueAtTime(660, now + 0.2);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now); osc.stop(now + 0.5);
        } else if (tipe === 'salah') {
            // Nada turun pendek
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.setValueAtTime(180, now + 0.15);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
        } else if (tipe === 'levelup') {
            // Fanfare singkat
            osc.type = 'square';
            const freqs = [523, 659, 784, 1047];
            freqs.forEach((f, i) => osc.frequency.setValueAtTime(f, now + i * 0.1));
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
            osc.start(now); osc.stop(now + 0.7);
        } else if (tipe === 'klik') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now); osc.stop(now + 0.08);
        }
    } catch(e) { /* Senyap jika gagal */ }
}

// ─────────────────────────────────────────────
// TIMER (mode tantangan)
// ─────────────────────────────────────────────
function mulaiTimer() {
    timerSisa = TIMER_TOTAL;
    document.getElementById('timer-container')?.classList.remove('hidden');
    updateTimerUI();
    timerInterval = setInterval(() => {
        timerSisa--;
        updateTimerUI();
        if (timerSisa <= 0) {
            clearInterval(timerInterval);
            tampilkanToast('⏰ Waktu habis!', '#FF6B6B', 2000);
            setTimeout(tampilkanModalSkor, 2200);
        }
    }, 1000);
}

function updateTimerUI() {
    const bar   = document.getElementById('timer-bar');
    const label = document.getElementById('timer-label');
    if (!bar || !label) return;
    const pct = (timerSisa / TIMER_TOTAL) * 100;
    bar.style.width = pct + '%';
    label.textContent = timerSisa;
    bar.classList.remove('warning', 'danger');
    label.classList.remove('danger');
    if (timerSisa <= 10) { bar.classList.add('danger');  label.classList.add('danger'); }
    else if (timerSisa <= 20) { bar.classList.add('warning'); }
}

function tambahWaktu(detik) {
    timerSisa = Math.min(TIMER_TOTAL, timerSisa + detik);
    updateTimerUI();
}

// ─────────────────────────────────────────────
// POWER-UPS
// ─────────────────────────────────────────────
function updatePowerUpsUI() {
    document.getElementById('hint-count').textContent  = powerUps.hint      > 0 ? powerUps.hint + 'x'      : '0x';
    document.getElementById('skip-count').textContent  = powerUps.skipGratis > 0 ? powerUps.skipGratis + 'x' : '0x';
    document.getElementById('dxp-count').textContent   = powerUps.doubleXP  > 0 ? powerUps.doubleXP + 'x'  : '0x';
    document.getElementById('fifty-count').textContent = powerUps.fiftyFifty > 0 ? powerUps.fiftyFifty + 'x' : '0x';

    document.getElementById('btn-hint').disabled      = powerUps.hint      <= 0;
    document.getElementById('btn-skip-free').disabled = powerUps.skipGratis <= 0;
    document.getElementById('btn-double-xp').disabled = powerUps.doubleXP  <= 0 && !doubleXPAktif;
    document.getElementById('btn-fifty').disabled     = powerUps.fiftyFifty <= 0;
}

function gunakanHint() {
    if (powerUps.hint <= 0) return;
    const soal = dataSoal[indexSoalAktif];
    if (!soal) return;
    playSoundEffect('klik');
    powerUps.hint--;
    updatePowerUpsUI();

    if (soal.tipe === 'ucapkan') {
        tampilkanToast(`💡 Hint: Kata ini artinya "${soal.terjemahan}" dan diawali huruf "${soal.kata[0]}"`, '#A06CD5', 3500);
    } else if (soal.tipe === 'cocokkan') {
        tampilkanToast(`💡 Hint: Jawaban mengandung huruf "${soal.terjemahan_benar[0]}"`, '#A06CD5', 3000);
    } else if (soal.tipe === 'scramble') {
        // Tampilkan satu huruf pertama di slot pertama yang kosong
        const kosong = scrambleJawaban.indexOf(null);
        if (kosong !== -1) {
            const hurufBenar = scrambleKata[kosong];
            // Cari tile huruf ini yang belum dipakai
            const tiles = document.querySelectorAll('.huruf-tile:not(.used)');
            for (const t of tiles) {
                if (t.dataset.huruf === hurufBenar) { t.click(); break; }
            }
        }
        tampilkanToast(`💡 Hint: Satu huruf sudah diisikan!`, '#A06CD5', 2500);
    }
}

function gunakanSkipGratis() {
    if (powerUps.skipGratis <= 0) return;
    playSoundEffect('klik');
    powerUps.skipGratis--;
    updatePowerUpsUI();
    tampilkanToast('⏭️ Soal dilewati (gratis)!', '#4DA8DA');
    lanjutSoal();
}

function gunakanDoubleXP() {
    if (powerUps.doubleXP <= 0 && !doubleXPAktif) return;
    if (!doubleXPAktif) {
        powerUps.doubleXP--;
        doubleXPAktif = true;
        playSoundEffect('klik');
        document.getElementById('btn-double-xp').style.background = 'linear-gradient(135deg,#FFD93D,#FFA07A)';
        document.getElementById('dxp-count').textContent = 'AKTIF';
        tampilkanToast('⚡ 2× XP aktif untuk soal ini!', '#FFD93D', 2500);
        updatePowerUpsUI();
    }
}

function gunakanFiftyFifty() {
    if (powerUps.fiftyFifty <= 0) return;
    const soal = dataSoal[indexSoalAktif];
    if (soal?.tipe !== 'cocokkan') {
        tampilkanToast('✂️ 50:50 hanya untuk soal Cocokkan!', '#FFA07A', 2000);
        return;
    }
    playSoundEffect('klik');
    powerUps.fiftyFifty--;
    updatePowerUpsUI();

    // Hapus 2 pilihan salah secara acak
    const btns = [...document.querySelectorAll('.pilihan-btn:not(:disabled)')];
    const salah = btns.filter(b => b.querySelector('span:last-child')?.textContent !== soal.terjemahan_benar);
    const hapus = salah.sort(() => Math.random() - 0.5).slice(0, 2);
    hapus.forEach(b => { b.style.opacity = '0.15'; b.disabled = true; });
    tampilkanToast('✂️ 2 jawaban salah dihapus!', '#A06CD5', 2000);
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
        dot.className = 'w-2.5 h-2.5 rounded-full transition-all duration-300 ';
        if (i === indexSoalAktif)    dot.className += 'dot-active';
        else if (i < indexSoalAktif) dot.className += 'dot-done';
        else                          dot.className += 'dot-inactive';
        if (soal.tipe === 'cocokkan')  dot.style.borderRadius = '4px';
        if (soal.tipe === 'scramble')  dot.style.borderRadius = '2px';
        container.appendChild(dot);
    });
    const el = document.getElementById('label-nomor-soal');
    if (el) el.textContent = `${indexSoalAktif + 1} / ${dataSoal.length}`;
    const elSkor = document.getElementById('skor-live');
    if (elSkor) elSkor.textContent = skorTotal;
}

// ─────────────────────────────────────────────
// TAMPILKAN SOAL
// ─────────────────────────────────────────────
function tampilkanSoal(idx) {
    const soal = dataSoal[idx];
    if (!soal) { tampilkanModalSkor(); return; }

    doubleXPAktif = false;
    document.getElementById('btn-double-xp').style.background = '';
    resetVoiceTranscript();

    if      (soal.tipe === 'cocokkan') tampilkanSoalCocokkan(soal);
    else if (soal.tipe === 'scramble') tampilkanSoalScramble(soal);
    else                               tampilkanSoalUcapkan(soal);

    renderProgressDots();
    animasiMasukKartu();
}

// ── Soal UCAPKAN ────────────────────────────
function tampilkanSoalUcapkan(soal) {
    document.getElementById('section-ucapkan').classList.remove('hidden');
    document.getElementById('section-cocokkan').classList.add('hidden');
    document.getElementById('section-scramble').classList.add('hidden');

    const gambarEl = document.getElementById('gambar-soal');
    const emojiEl  = document.getElementById('emoji-soal');
    if (soal.gambar) {
        gambarEl.src = soal.gambar; gambarEl.alt = soal.kata;
        gambarEl.classList.remove('hidden'); emojiEl.classList.add('hidden');
    } else if (soal.emoji) {
        emojiEl.textContent = soal.emoji;
        emojiEl.classList.remove('hidden'); gambarEl.classList.add('hidden');
    }

    document.getElementById('teks-kata').textContent       = soal.kata;
    document.getElementById('teks-terjemahan').textContent = `(${soal.terjemahan})`;
    document.getElementById('badge-kategori').textContent  = soal.kategori?.toUpperCase() || '';
    document.getElementById('badge-kategori').style.background = soal.warnaBadge;
    resetInstruksi();
}

// ── Soal COCOKKAN ───────────────────────────
function tampilkanSoalCocokkan(soal) {
    document.getElementById('section-ucapkan').classList.add('hidden');
    document.getElementById('section-cocokkan').classList.remove('hidden');
    document.getElementById('section-scramble').classList.add('hidden');

    document.getElementById('cocokkan-kata').textContent       = soal.kata;
    document.getElementById('badge-cocokkan').style.background = soal.warnaBadge;
    document.getElementById('feedback-cocokkan').classList.add('hidden');

    const gambarEl = document.getElementById('cocokkan-gambar');
    const emojiEl  = document.getElementById('cocokkan-emoji');
    if (soal.gambar) {
        gambarEl.src = soal.gambar;
        gambarEl.classList.remove('hidden'); emojiEl.classList.add('hidden');
    } else if (soal.emoji) {
        emojiEl.textContent = soal.emoji;
        emojiEl.classList.remove('hidden'); gambarEl.classList.add('hidden');
    }

    const container = document.getElementById('container-pilihan');
    container.innerHTML = '';
    const pilihanAcak = [...soal.pilihan].sort(() => Math.random() - 0.5);
    pilihanAcak.forEach((pilihan, i) => {
        const btn = document.createElement('button');
        btn.className = 'pilihan-btn';
        btn.innerHTML = `<span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-800 flex-shrink-0"
                              style="background:linear-gradient(135deg,#4DA8DA,#A06CD5);color:white;">
                            ${String.fromCharCode(65 + i)}
                         </span><span>${pilihan}</span>`;
        btn.onclick = () => handlePilihJawaban(btn, pilihan, soal.terjemahan_benar, soal);
        container.appendChild(btn);
    });
}

// ── Soal SCRAMBLE ────────────────────────────
function tampilkanSoalScramble(soal) {
    document.getElementById('section-ucapkan').classList.add('hidden');
    document.getElementById('section-cocokkan').classList.add('hidden');
    document.getElementById('section-scramble').classList.remove('hidden');

    scrambleKata    = soal.kata.toUpperCase();
    scrambleJawaban = new Array(scrambleKata.length).fill(null);

    document.getElementById('scramble-emoji').textContent      = soal.emoji || '❓';
    document.getElementById('scramble-terjemahan').textContent = `(${soal.terjemahan})`;
    document.getElementById('badge-scramble').style.background = soal.warnaBadge;
    document.getElementById('feedback-scramble').classList.add('hidden');

    renderScrambleUI();
}

function renderScrambleUI() {
    // Buat slot jawaban
    const slotsEl = document.getElementById('jawaban-slots');
    slotsEl.innerHTML = '';
    for (let i = 0; i < scrambleKata.length; i++) {
        const slot = document.createElement('div');
        slot.className = 'jawaban-slot';
        slot.dataset.idx = i;
        if (scrambleJawaban[i]) {
            slot.textContent = scrambleJawaban[i].huruf;
            slot.classList.add('filled');
            slot.onclick = () => kembalikanHuruf(i);
        }
        slotsEl.appendChild(slot);
    }

    // Buat tiles huruf (acak)
    const hurufAcak = acakHuruf(scrambleKata);
    const tilesEl   = document.getElementById('huruf-tiles');
    tilesEl.innerHTML = '';

    const sudahDipakai = new Set(
        scrambleJawaban.filter(Boolean).map(h => h.tileIdx)
    );

    hurufAcak.forEach((huruf, idx) => {
        const tile = document.createElement('button');
        tile.className   = 'huruf-tile';
        tile.dataset.huruf    = huruf;
        tile.dataset.tileIdx  = idx;
        tile.textContent = huruf;
        if (sudahDipakai.has(idx)) tile.classList.add('used');
        tile.onclick = () => pilihHurufScramble(tile, huruf, idx);
        tilesEl.appendChild(tile);
    });
}

// Simpan seed acak per soal agar konsisten selama soal ini
let _scrambleSeed = null;
function acakHuruf(kata) {
    if (!_scrambleSeed) _scrambleSeed = Date.now();
    const arr  = kata.split('');
    // Fisher-Yates dengan seed sederhana (untuk konsistensi per soal)
    let seed = _scrambleSeed;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Pastikan tidak sama dengan kata asli
    if (arr.join('') === kata && kata.length > 1) { [arr[0], arr[1]] = [arr[1], arr[0]]; }
    return arr;
}

function pilihHurufScramble(tile, huruf, tileIdx) {
    if (tile.classList.contains('used')) return;
    // Cari slot kosong pertama
    const slotKosong = scrambleJawaban.indexOf(null);
    if (slotKosong === -1) return;

    playSoundEffect('klik');
    scrambleJawaban[slotKosong] = { huruf, tileIdx };
    tile.classList.add('used');

    // Update slot UI langsung tanpa full re-render (lebih mulus)
    const slots = document.querySelectorAll('.jawaban-slot');
    const slot  = slots[slotKosong];
    if (slot) {
        slot.textContent = huruf;
        slot.classList.add('filled');
        slot.onclick = () => kembalikanHuruf(slotKosong);
    }
}

function kembalikanHuruf(slotIdx) {
    const entry = scrambleJawaban[slotIdx];
    if (!entry) return;
    playSoundEffect('klik');
    scrambleJawaban[slotIdx] = null;

    // Kembalikan tile
    const tile = document.querySelector(`.huruf-tile[data-tile-idx="${entry.tileIdx}"]`);
    if (tile) tile.classList.remove('used');

    // Kosongkan slot UI
    const slots = document.querySelectorAll('.jawaban-slot');
    const slot  = slots[slotIdx];
    if (slot) {
        slot.textContent = '';
        slot.classList.remove('filled');
        slot.onclick = null;
    }
}

function resetScramble() {
    playSoundEffect('klik');
    scrambleJawaban = new Array(scrambleKata.length).fill(null);
    _scrambleSeed = null;
    tampilkanSoalScramble(dataSoal[indexSoalAktif]);
}

function cekScramble() {
    if (scrambleJawaban.includes(null)) {
        tampilkanToast('⚠️ Isi semua huruf dulu!', '#FFA07A', 1500);
        return;
    }

    const jawabanUser = scrambleJawaban.map(h => h.huruf).join('');
    const benar       = jawabanUser === scrambleKata;
    const soal        = dataSoal[indexSoalAktif];
    const xpDapat     = soal.xp || 15;

    // Warna slot
    const slots = document.querySelectorAll('.jawaban-slot');
    slots.forEach((slot, i) => {
        slot.classList.remove('filled');
        slot.classList.add(benar ? 'benar-final' : 'salah-final');
    });

    // Disable semua tiles
    document.querySelectorAll('.huruf-tile').forEach(t => t.disabled = true);

    if (benar) {
        const xpDapat2 = tambahXP(xpDapat);
        const poin     = 100;
        skorTotal     += poin;
        playSoundEffect('benar');
        tampilkanFeedback('scramble', `✅ Benar! "${scrambleKata}" 🎉 (+${poin} poin, +${xpDapat2} XP)`, '#6BCB77');
        tampilkanToast(`🌟 Keren! Kata tersusun dengan benar! +${poin} poin`, '#6BCB77', 2000);
        if (profilSiswa.mode === 'tantangan') tambahWaktu(5);
    } else {
        const poin = 20;
        skorTotal += poin;
        playSoundEffect('salah');
        tampilkanFeedback('scramble', `❌ Kurang tepat! Jawaban benar: "${scrambleKata}" (+${poin} poin)`, '#FF6B6B');
        tampilkanToast(`💪 Jawaban benar: ${scrambleKata}`, '#FFA07A', 2500);
    }

    setTimeout(() => lanjutSoal(), 2400);
}

function tampilkanFeedback(tipe, pesan, warna) {
    const elId = tipe === 'scramble' ? 'feedback-scramble' : 'feedback-cocokkan';
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent        = pesan;
    el.style.background   = warna;
    el.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// HANDLER PILIH JAWABAN (COCOKKAN)
// ─────────────────────────────────────────────
function handlePilihJawaban(btn, pilihanUser, jawabanBenar, soal) {
    document.querySelectorAll('.pilihan-btn').forEach(b => b.disabled = true);
    const benar = pilihanUser === jawabanBenar;
    const poin  = benar ? 100 : 30;
    skorTotal  += poin;

    if (benar) {
        btn.classList.add('benar');
        const xpDapat = tambahXP(soal.xp || 10);
        playSoundEffect('benar');
        tampilkanFeedback('cocokkan', `✅ Benar! "${soal.kata}" = "${jawabanBenar}" (+${poin} poin, +${xpDapat} XP)`, '#6BCB77');
        tampilkanToast(`🎉 Mantap! +${poin} poin`, '#6BCB77', 1800);
        if (profilSiswa.mode === 'tantangan') tambahWaktu(3);
    } else {
        btn.classList.add('salah');
        document.querySelectorAll('.pilihan-btn').forEach(b => {
            if (b.querySelector('span:last-child')?.textContent === jawabanBenar) b.classList.add('benar');
        });
        playSoundEffect('salah');
        tampilkanFeedback('cocokkan', `❌ Jawaban benar: "${jawabanBenar}" (+${poin} poin)`, '#FF6B6B');
        tampilkanToast(`💪 Hampir! Jawabannya: ${jawabanBenar}`, '#FFA07A', 2000);
    }

    setTimeout(() => lanjutSoal(), 2200);
}

// ─────────────────────────────────────────────
// DENGARKAN AUDIO
// ─────────────────────────────────────────────
function handleDengarkan() {
    const soal = dataSoal[indexSoalAktif];
    playSoundEffect('klik');
    tampilkanToast(`🔊 Mendengarkan "${soal.kata}"...`, '#4DA8DA');
    const btn = document.getElementById('btn-dengar');
    if (btn) { btn.classList.add('scale-95'); setTimeout(() => btn.classList.remove('scale-95'), 200); }

    const audio = new Audio(soal.audio_referensi);
    audio.play().catch(() => {
        if ('speechSynthesis' in window) {
            const utt  = new SpeechSynthesisUtterance(soal.kata);
            utt.lang = 'en-US'; utt.rate = 0.85; utt.pitch = 1.1;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utt);
        }
    });
}

// ─────────────────────────────────────────────
// SPEECH RECOGNITION
// ─────────────────────────────────────────────
function inisialisasiSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('[App] Speech Recognition tidak didukung.'); return; }

    speechRecognition = new SR();
    speechRecognition.lang            = 'en-US';
    speechRecognition.interimResults  = true;
    speechRecognition.continuous      = false;
    speechRecognition.maxAlternatives = 3;

    speechRecognition.onstart  = () => tampilkanVoiceTranscript('...', false);
    speechRecognition.onresult = (event) => {
        let final = '', interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) final   += t;
            else                           interim += t;
        }
        transkripSementara = final || interim;
        tampilkanVoiceTranscript(transkripSementara, !!final);
        if (final) {
            const soal = dataSoal[indexSoalAktif];
            const target = soal?.kata?.toLowerCase().trim() || '';
            const ucapkan = final.toLowerCase().trim();
            const cocok   = ucapkan.includes(target) || target.includes(ucapkan) || hitungSimilaritas(ucapkan, target) > 0.65;
            tampilkanMatchTranscript(cocok, soal?.kata || '');
        }
    };
    speechRecognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') tampilkanVoiceTranscript(`⚠️ ${e.error}`, false);
    };
    speechRecognition.onend = () => console.log('[SR] Selesai.');
}

function hitungSimilaritas(s1, s2) {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;
    const longer  = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const len     = longer.length;
    if (len === 0) return 1;
    const edit = levenshteinDistance(longer, shorter);
    return (len - edit) / len;
}

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => i===0?j:j===0?i:0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = s1[i-1]===s2[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
}

function tampilkanVoiceTranscript(teks, isFinal) {
    const c = document.getElementById('voice-transcript');
    const t = document.getElementById('transcript-text');
    if (!c || !t) return;
    c.classList.remove('hidden');
    t.textContent = `"${teks}"`;
    t.style.color = isFinal ? '#1f2937' : '#9ca3af';
}

function tampilkanMatchTranscript(cocok, kataSoal) {
    const div  = document.getElementById('transcript-match');
    const icon = document.getElementById('match-icon');
    const txt  = document.getElementById('match-text');
    if (!div || !icon || !txt) return;
    div.classList.remove('hidden');
    if (cocok) {
        icon.textContent = '✅'; txt.textContent = `Pengucapan "${kataSoal}" terdeteksi!`; txt.style.color = '#166534';
    } else {
        icon.textContent = '🔄'; txt.textContent = `Coba ucapkan "${kataSoal}" lebih jelas.`; txt.style.color = '#92400e';
    }
}

function resetVoiceTranscript() {
    document.getElementById('voice-transcript')?.classList.add('hidden');
    document.getElementById('transcript-match')?.classList.add('hidden');
    transkripSementara = '';
}

// ─────────────────────────────────────────────
// WAVEFORM CANVAS
// ─────────────────────────────────────────────
function inisialisasiWaveformCanvas() {
    waveformCanvas = document.getElementById('waveform-canvas');
    if (!waveformCanvas) return;
    canvasCtx = waveformCanvas.getContext('2d');
}

function mulaiRenderWaveform(analyserNode) {
    if (!canvasCtx || !waveformCanvas) return;
    _analyserNode = analyserNode;
    waveformCanvas.classList.add('active');
    document.getElementById('waveform-bars')?.classList.add('hidden');
    renderLoopWaveform();
}

function renderLoopWaveform() {
    if (!_analyserNode || !canvasCtx) return;
    const bufLen    = _analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufLen);
    _analyserNode.getByteTimeDomainData(dataArray);
    const W = waveformCanvas.width, H = waveformCanvas.height;
    canvasCtx.clearRect(0, 0, W, H);
    const grad = canvasCtx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(255,107,107,0.08)');
    grad.addColorStop(0.5, 'rgba(77,168,218,0.12)');
    grad.addColorStop(1,   'rgba(160,108,213,0.08)');
    canvasCtx.fillStyle = grad;
    canvasCtx.fillRect(0, 0, W, H);
    canvasCtx.lineWidth = 2.5;
    canvasCtx.strokeStyle = '#FF6B6B';
    canvasCtx.shadowColor = '#FF6B6B';
    canvasCtx.shadowBlur  = 6;
    canvasCtx.beginPath();
    const sliceW = W / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * H) / 2;
        if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
        x += sliceW;
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
    if (canvasCtx && waveformCanvas) canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
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
        const ctx = EngliKidsDSP.getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;

        await EngliKidsDSP.startRecording({
            maxDuration: 4000,
            onVolumeUpdate: (rms) => {
                document.querySelectorAll('.wave-bar').forEach((bar, i) => {
                    bar.style.height = Math.max(6, Math.round(rms * 60) + (i % 2 === 0 ? 4 : 8)) + 'px';
                });
            },
        });

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);
            mulaiRenderWaveform(analyser);
            window._uiStream = stream;
        } catch(e) {
            document.getElementById('waveform-bars')?.classList.remove('hidden');
            document.getElementById('waveform-bars')?.classList.add('flex');
        }

        uiSedangRekam = true;
        document.getElementById('btn-mic')?.classList.add('recording');
        const instruksi = document.getElementById('teks-instruksi');
        if (instruksi) { instruksi.textContent = '🎙️ Sedang merekam... ucapkan kata-nya!'; instruksi.style.color = '#FF6B6B'; }

        if (speechRecognition) { try { speechRecognition.start(); } catch(e) {} }

        setTimeout(async () => { if (uiSedangRekam) await stopRekam(); }, 4500);
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
    const instruksi = document.getElementById('teks-instruksi');
    if (instruksi) { instruksi.textContent = '⏳ Menganalisa suaramu...'; instruksi.style.color = '#A06CD5'; }

    if (window._uiStream) { window._uiStream.getTracks().forEach(t => t.stop()); window._uiStream = null; }
    if (speechRecognition) { try { speechRecognition.stop(); } catch(e) {} }

    try {
        const audioBuffer = await EngliKidsDSP.stopRecording();
        window._lastRecordedBuffer = audioBuffer;
        await prosesAudio();
    } catch (err) {
        if (err.message?.includes('Tidak ada rekaman')) {
            if (window._lastRecordedBuffer) await prosesAudio();
            else setTimeout(async () => {
                if (window._lastRecordedBuffer) await prosesAudio();
                else { tampilkanToast('⚠️ Rekaman terlalu pendek, coba lagi!', '#FFA07A'); resetInstruksi(); }
            }, 500);
        } else {
            tampilkanToast('⚠️ Rekaman gagal diproses.', '#FFA07A');
            resetInstruksi();
        }
    }
}

// ─────────────────────────────────────────────
// PROSES AUDIO
// ─────────────────────────────────────────────
async function prosesAudio() {
    if (!window._lastRecordedBuffer) { tampilkanToast('❌ Tidak ada data audio.', '#FF6B6B'); resetInstruksi(); return; }
    const soal = dataSoal[indexSoalAktif];
    try {
        let hasil;
        try {
            const probe = await fetch(soal.audio_referensi, { method: 'HEAD' });
            if (probe.ok) hasil = await EngliKidsDSP.scorePronunciation(window._lastRecordedBuffer, soal.audio_referensi);
            else throw new Error('File referensi tidak ditemukan.');
        } catch(_) {
            hasil = EngliKidsDSP.simulateScore(window._lastRecordedBuffer);
        }

        let skorFinal = hasil.skorAkhir;
        if (transkripSementara) {
            const target  = soal.kata?.toLowerCase().trim() || '';
            const ucapkan = transkripSementara.toLowerCase().trim();
            const cocok   = ucapkan.includes(target) || hitungSimilaritas(ucapkan, target) > 0.65;
            if (cocok  && skorFinal < 75) skorFinal = Math.min(100, skorFinal + 15);
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

function tampilkanHasilSkorUcapkan(skor, soal) {
    const poin = Math.round((skor / 100) * 100);
    skorTotal += poin;

    if (skor >= 90) {
        playSoundEffect('benar');
        tambahXP(soal.xp || 10);
        tampilkanToast(`🌟 Sempurna! "${soal.kata}" benar! (+${poin} poin)`, '#6BCB77', 2500);
        if (profilSiswa.mode === 'tantangan') tambahWaktu(5);
    } else if (skor >= 70) {
        playSoundEffect('benar');
        tambahXP(Math.floor((soal.xp || 10) * 0.7));
        tampilkanToast(`👍 Bagus! Hampir sempurna! (+${poin} poin)`, '#4DA8DA', 2500);
    } else {
        playSoundEffect('salah');
        tampilkanToast(`💪 Terus berlatih! (+${poin} poin)`, '#FFA07A', 2500);
    }

    setTimeout(lanjutSoal, 2800);
}

// ─────────────────────────────────────────────
// LANJUT KE SOAL BERIKUTNYA
// ─────────────────────────────────────────────
function lanjutSoal() {
    _scrambleSeed = null;
    indexSoalAktif++;
    if (indexSoalAktif < dataSoal.length) tampilkanSoal(indexSoalAktif);
    else tampilkanModalSkor();
}

// ─────────────────────────────────────────────
// LEWATI
// ─────────────────────────────────────────────
function handleLewati() {
    tampilkanToast('⏭️ Soal dilewati...', '#FFA07A');
    berhentiRenderWaveform();
    if (speechRecognition) { try { speechRecognition.stop(); } catch(e) {} }
    _scrambleSeed = null;
    setTimeout(lanjutSoal, 600);
}

// ─────────────────────────────────────────────
// MODAL SKOR AKHIR
// ─────────────────────────────────────────────
function tampilkanModalSkor() {
    if (timerInterval) clearInterval(timerInterval);

    const maxSkor    = dataSoal.reduce((s, q) => s + 100, 0);
    const persentase = maxSkor > 0 ? (skorTotal / maxSkor) * 100 : 0;
    const modal      = document.getElementById('modal-skor');

    document.getElementById('modal-avatar').textContent = persentase >= 90 ? '🏆' : persentase >= 60 ? '😊' : '💪';
    document.getElementById('skor-angka').textContent   = skorTotal;
    document.getElementById('skor-dari').textContent    = `dari ${maxSkor} poin`;

    // XP sesi
    const totalXP = parseInt(localStorage.getItem('englikids_totalxp') || '0');
    const { level } = hitungLevel(totalXP);
    document.getElementById('modal-xp-val').textContent    = xpSesiIni;
    document.getElementById('modal-level-info').textContent = `• Level ${level}`;

    let pesan, jumlahBintang;
    if (persentase >= 90)      { pesan = '🏆 Luar biasa! Kamu bintang Bahasa Inggris!'; jumlahBintang = 3; }
    else if (persentase >= 60) { pesan = '🚀 Keren! Hampir sempurna, terus semangat!';  jumlahBintang = 2; }
    else                       { pesan = '💪 Jangan menyerah! Latihan terus ya, Champ!'; jumlahBintang = 1; }

    document.getElementById('pesan-motivasi').textContent = pesan;
    modal.classList.remove('hidden');

    perbaruiStreak();
    simpanSkor(profilSiswa.nama);

    for (let i = 1; i <= 3; i++) {
        const star = document.getElementById(`star-${i}`);
        if (!star) continue;
        star.classList.remove('active');
        if (i <= jumlahBintang) setTimeout(() => star.classList.add('active'), i * 300);
    }

    if (jumlahBintang === 3) playSoundEffect('levelup');
    else if (jumlahBintang >= 2) playSoundEffect('benar');

    setTimeout(tembakKonfeti, 400);
}

// ─────────────────────────────────────────────
// KONFETI
// ─────────────────────────────────────────────
const WARNA_KONFETI = ['#FFD93D','#FF6B6B','#6BCB77','#4DA8DA','#A06CD5','#FFA07A'];
function tembakKonfeti() {
    const c = document.getElementById('konfeti-container');
    if (!c) return;
    c.innerHTML = '';
    for (let i = 0; i < 35; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.left              = Math.random() * 100 + '%';
        p.style.top               = '-10px';
        p.style.background        = WARNA_KONFETI[Math.floor(Math.random() * WARNA_KONFETI.length)];
        p.style.animationDelay    = Math.random() * 0.8 + 's';
        p.style.animationDuration = (1.2 + Math.random() * 1) + 's';
        p.style.borderRadius      = Math.random() > 0.5 ? '50%' : '2px';
        c.appendChild(p);
    }
}

// ─────────────────────────────────────────────
// TOMBOL MODAL
// ─────────────────────────────────────────────
function handleMainLagi() {
    indexSoalAktif = 0; skorTotal = 0; xpSesiIni = 0;
    doubleXPAktif = false;
    _scrambleSeed = null;
    powerUps = { hint: 1, skipGratis: 2, doubleXP: 1, fiftyFifty: 1 };
    document.getElementById('modal-skor').classList.add('hidden');
    document.getElementById('timer-container')?.classList.add('hidden');
    siapkanSoalSesuaiMode();
    updatePowerUpsUI();
    resetVoiceTranscript();
    tampilkanSoal(0);
    if (profilSiswa.mode === 'tantangan') mulaiTimer();
    tampilkanToast('🎮 Permainan dimulai lagi!', '#FF6B6B');
}

function handleLihatRiwayat() {
    const riwayat   = JSON.parse(localStorage.getItem('englikids_riwayat') || '[]');
    if (riwayat.length === 0) { tampilkanToast('📊 Belum ada riwayat skor.', '#A06CD5', 2000); return; }

    const sorted    = [...riwayat].sort((a, b) => b.skor - a.skor).slice(0, 5);
    const riwDiv    = document.getElementById('riwayat-mini');
    const riwList   = document.getElementById('riwayat-list');
    riwDiv?.classList.remove('hidden');
    const medals = ['🥇','🥈','🥉'];
    riwList.innerHTML = sorted.map((r, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;" class="font-nunito font-700 text-xs text-gray-600">
        <span>${medals[i] || (i+1)+'.'} ${r.avatar || ''} ${r.namaDisplay || 'Anonim'}</span>
        <span style="color:#6BCB77;">${r.skor}</span>
      </div>`).join('');
}

// ─────────────────────────────────────────────
// SIMPAN SKOR
// ─────────────────────────────────────────────
async function simpanSkor(namaUser = 'Anonim') {
    try {
        const { hashPassword, compressRLE, getCompressionRatio } = EngliKidsSecurity;
        const namaHash        = await hashPassword(namaUser + '_englikids_salt');
        const tanggal         = new Date().toISOString();
        const stringSesi      = `${namaUser}|${skorTotal}|${tanggal}`;
        const sesiTerkompresi = compressRLE(stringSesi);
        const rasio           = getCompressionRatio(stringSesi, sesiTerkompresi);

        console.log(`[App] RLE: ${rasio.originalLen}→${rasio.compressedLen}, ${rasio.ratio}`);

        const sesiData = {
            namaHash     : namaHash.slice(0,16) + '...',
            namaDisplay  : namaUser,
            avatar       : profilSiswa.avatar,
            skor         : skorTotal,
            xpGained     : xpSesiIni,
            mode         : profilSiswa.mode,
            maxSkor      : dataSoal.length * 100,
            tanggal,
            sesiTerkompresi,
            kompresiRasio: rasio.ratio,
        };

        const KEY = 'englikids_riwayat';
        const lama = JSON.parse(localStorage.getItem(KEY) || '[]');
        lama.push(sesiData);
        if (lama.length > 50) lama.splice(0, lama.length - 50);
        localStorage.setItem(KEY, JSON.stringify(lama));
    } catch(err) {
        console.warn('[App] Gagal simpan skor:', err);
    }
}

// ─────────────────────────────────────────────
// UTILITAS UI
// ─────────────────────────────────────────────
let toastTimeout = null;
function tampilkanToast(pesan, warna = '#6BCB77', durasi = 2000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.textContent      = pesan;
    toast.style.background = `linear-gradient(135deg,${warna},${warna}dd)`;
    toast.style.opacity    = '1';
    toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, durasi);
}

function resetInstruksi() {
    const el = document.getElementById('teks-instruksi');
    if (el) { el.textContent = 'Tekan tombol di bawah, lalu ucapkan kata tersebut! 🎙️'; el.style.color = ''; }
}

function animasiMasukKartu() {
    const sections = ['section-ucapkan','section-cocokkan','section-scramble'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
            el.style.animation = 'none';
            requestAnimationFrame(() => { el.style.animation = ''; });
        }
    });
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
