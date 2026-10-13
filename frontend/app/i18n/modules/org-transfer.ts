// Translations for moving a business between WareSys installs (web ⇄
// desktop): the export in Settings, the desktop app's first-launch import
// (/register/import) and the platform console's import/export. Owns the
// top-level `orgTransfer` key.
export const orgTransfer = {
  en: {
    orgTransfer: {
      password: 'File password',
      passwordRepeat: 'Repeat password',
      passwordHint: 'At least 8 characters. It is needed to import the file and cannot be recovered, so keep it safe.',
      passwordTooShort: 'Use at least 8 characters.',
      passwordMismatch: "The passwords don't match.",
      file: 'Export file (.wsexport)',
      cancel: 'Cancel',
      export: {
        heading: 'Export business data',
        description:
          'Download everything this business has (products, customers, invoices, purchasing, accounting, users and uploaded files) as one encrypted file. Use it to move between WareSys web and the WareSys desktop app.',
        button: 'Export',
        exporting: 'Exporting…',
        done: 'Export downloaded.',
      },
      import: {
        link: 'Moving from WareSys web or another PC? Import your data',
        title: 'Import your business',
        subtitle:
          'Bring in a WareSys export (.wsexport). Your data and users come with it, and everyone signs in with their existing email and password.',
        button: 'Import',
        importing: 'Importing… this can take a few minutes.',
        done: '{name} was imported. Sign in with your existing email and password.',
        toLogin: 'Go to sign in',
        back: 'Back to registration',
      },
      platform: {
        importButton: 'Import business',
        importTitle: 'Import a business',
        importHelp:
          'From a WareSys export (.wsexport), e.g. a desktop customer moving to the web. It arrives with no modules and the default plan and seats: set those afterwards.',
        imported: '{name} was imported ({rows} records, {files} files).',
        exportButton: 'Export',
        exportTitle: 'Export {name}',
        exportHelp:
          'Download this business as an encrypted .wsexport, e.g. to move it to the desktop app. Give the customer the file and the password.',
      },
    },
  },
  id: {
    orgTransfer: {
      password: 'Kata sandi file',
      passwordRepeat: 'Ulangi kata sandi',
      passwordHint: 'Minimal 8 karakter. Diperlukan untuk mengimpor file dan tidak bisa dipulihkan, jadi simpan baik-baik.',
      passwordTooShort: 'Gunakan minimal 8 karakter.',
      passwordMismatch: 'Kata sandi tidak sama.',
      file: 'File ekspor (.wsexport)',
      cancel: 'Batal',
      export: {
        heading: 'Ekspor data usaha',
        description:
          'Unduh semua data usaha ini (produk, pelanggan, faktur, pembelian, akuntansi, pengguna, dan file yang diunggah) sebagai satu file terenkripsi. Gunakan untuk pindah antara WareSys web dan aplikasi desktop WareSys.',
        button: 'Ekspor',
        exporting: 'Mengekspor…',
        done: 'Ekspor sudah diunduh.',
      },
      import: {
        link: 'Pindah dari WareSys web atau PC lain? Impor data Anda',
        title: 'Impor usaha Anda',
        subtitle:
          'Masukkan file ekspor WareSys (.wsexport). Data dan pengguna ikut terbawa, dan semua orang masuk dengan email dan kata sandi yang sama seperti sebelumnya.',
        button: 'Impor',
        importing: 'Mengimpor… ini bisa memakan beberapa menit.',
        done: '{name} berhasil diimpor. Masuk dengan email dan kata sandi Anda yang sudah ada.',
        toLogin: 'Ke halaman masuk',
        back: 'Kembali ke pendaftaran',
      },
      platform: {
        importButton: 'Impor usaha',
        importTitle: 'Impor usaha',
        importHelp:
          'Dari file ekspor WareSys (.wsexport), mis. pelanggan desktop yang pindah ke web. Usaha masuk tanpa modul dan dengan paket serta kursi default: atur setelahnya.',
        imported: '{name} berhasil diimpor ({rows} data, {files} file).',
        exportButton: 'Ekspor',
        exportTitle: 'Ekspor {name}',
        exportHelp:
          'Unduh usaha ini sebagai .wsexport terenkripsi, mis. untuk dipindahkan ke aplikasi desktop. Berikan file dan kata sandinya ke pelanggan.',
      },
    },
  },
} as const;
