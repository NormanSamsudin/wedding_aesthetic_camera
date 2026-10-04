// Booth and gallery text in Malay and English. Each event picks its
// language in /settings. Elements with data-i18n="key" get the matching text.

window.TEXT = {
  ms: {
    locale: 'ms-MY',
    start: 'Mula rakam',
    watch: 'Tonton ucapan',
    getReady: 'Bersedia, pandang kamera',
    retake: 'Rakam semula',
    send: 'Hantar ucapan',
    saving: 'Menyimpan ucapan anda',
    tryAgain: 'Cuba lagi',
    thanks: 'Terima kasih',
    saved: 'Ucapan anda telah disimpan',
    savedLater: 'Ucapan anda disimpan dalam tablet ini dan akan dihantar sebentar lagi',
    saveFailed: 'Ucapan tidak dapat disimpan. Sila cuba lagi.',
    noEvent: 'Tiada majlis dipilih. Minta penganjur memilih majlis di tetapan, kemudian tekan Cuba lagi.',
    lowStorage: 'Storan hampir penuh',
    waiting: (n) => `${n} ucapan menunggu untuk dihantar`,
    prompts: [
      'Kongsikan doa dan harapan anda untuk pengantin',
      'Ceritakan kenangan manis bersama mereka',
      'Apa nasihat anda untuk alam rumah tangga?',
      'Ucapkan sesuatu yang akan mereka ingat selamanya',
    ],
    // gallery
    all: 'Semua',
    morning: 'Pagi',
    afternoon: 'Tengah hari',
    evening: 'Petang',
    night: 'Malam',
    featured: 'Ucapan pilihan',
    heroDesc: 'Ucapan untuk pengantin, dirakam di booth ini.',
    play: 'Main',
    playAll: 'Main semua ucapan',
    noWishes: 'Belum ada ucapan',
    noWishesNote: 'Ucapan akan dipaparkan di sini sebaik sahaja tetamu merakamnya.',
    backToWishes: '← Kembali ke ucapan',
    upNext: 'Seterusnya',
    justIn: 'Terbaru',
    newTag: 'BARU',
    noneInSession: (label) => `Belum ada ucapan waktu ${label.toLowerCase()}.`,
    wishesFor: (couple) => `Ucapan untuk ${couple}`,
  },
  en: {
    locale: undefined,
    start: 'Start recording',
    watch: 'Watch the wishes',
    getReady: 'Get ready, look at the camera',
    retake: 'Re-record',
    send: 'Send wish',
    saving: 'Saving your wish',
    tryAgain: 'Try again',
    thanks: 'Thank you',
    saved: 'Your wish has been saved',
    savedLater: 'Your wish is kept on this tablet and will be sent shortly',
    saveFailed: "That didn't save. Please try again.",
    noEvent: 'No event is selected, so this wish has nowhere to go. Ask the organiser to select one in settings, then tap Try again.',
    lowStorage: 'Storage almost full',
    waiting: (n) => `${n} ${n === 1 ? 'wish' : 'wishes'} waiting to send`,
    prompts: [
      'Share a prayer or a wish for the couple',
      'Tell a favourite memory with them',
      'What advice would you give for married life?',
      "Say something they'll remember forever",
    ],
    // gallery
    all: 'All',
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Night',
    featured: 'Featured wish',
    heroDesc: 'A wish for the newlyweds, recorded at the booth.',
    play: 'Play',
    playAll: 'Play all wishes',
    noWishes: 'No wishes yet',
    noWishesNote: 'They will appear here as guests record them at the booth.',
    backToWishes: '← Back to wishes',
    upNext: 'Up next',
    justIn: 'Just in',
    newTag: 'NEW',
    noneInSession: (label) => `No wishes in the ${label.toLowerCase()} yet.`,
    wishesFor: (couple) => `Wishes for ${couple}`,
  },
};

// Events created before languages existed are English.
window.textFor = (event) => window.TEXT[event?.language] || window.TEXT.en;

window.applyText = (t) => {
  document.documentElement.lang = t === window.TEXT.ms ? 'ms' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t[el.dataset.i18n];
  });
};
