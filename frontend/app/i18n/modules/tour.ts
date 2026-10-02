import { tourPages } from './tour-pages';

// Translations for the guided tours (app/components/tour). Owns the
// top-level `tour` key. Each module's tour lives under tour.<module>;
// step ids match the step keys in app/components/tour/tours.ts.
export const tour = {
  en: {
    tour: {
      next: 'Next',
      back: 'Back',
      finish: 'Finish',
      skip: 'Skip tutorial',
      counter: 'Step {current} of {total}',
      chip: '{module} tour',
      prompt: {
        eyebrow: 'Quick tour · about 1 minute',
        title: 'New to {module}?',
        body: 'Take a quick tour to learn how this module works.',
        pageEyebrow: 'Page tour · under a minute',
        pageTitle: 'Tour {module}?',
        pageBody: 'A short walkthrough of what each part of this page does.',
        start: 'Start tutorial',
        later: 'Maybe later',
      },
      help: {
        label: 'Help',
        sidebarLabel: 'Help & tutorial',
        tutorial: '{module} tutorial',
        tutorialHint: 'A 1-minute guided tour',
        tutorialDone: 'Completed · replay anytime',
        support: 'Contact support',
        supportHint: 'Chat with us on WhatsApp',
        newBadge: 'New',
        cardTitle: '{module} tour',
        cardHint: 'Learn this module in a minute',
        cardDoneHint: 'Replay the tour or get support',
        pageTour: 'Tour this page',
        pageCardTitle: 'Tour this page',
      },
      pages: tourPages.en,
      done: {
        title: '{module} tour complete',
        body: 'Replay it anytime from Help.',
      },
      ops: {
        title: 'OPS',
        steps: {
          intro: {
            title: 'Welcome to OPS',
            description:
              'Your warehouse scanner hub. Every stock movement (receiving, picking, moving, returns) happens in a session: start one, scan items, and complete it when you’re done.',
          },
          search: {
            title: 'Find anything',
            description: 'Type or scan a SKU, product, or location to see what’s where and its scan history.',
          },
          pendingOrders: {
            title: 'Orders waiting',
            description: 'Imported orders land here, ready to be fulfilled.',
          },
          modes: {
            title: 'Start a session',
            description:
              'Pick what you’re doing: Receive, Returns, Move, or Fulfill. Then just scan. Picks, moves, and returns update stock as you scan.',
          },
          receive: {
            title: 'Receiving is import-first',
            description:
              'An admin imports the delivery sheet (that adds the stock) and prints its labels. Choose that delivery here and scan to check what actually arrived.',
          },
          sessions: {
            title: 'Pick up where you left off',
            description: 'Open sessions stay here until completed. View all for the full history.',
          },
          labels: {
            title: 'Labels',
            description: 'Print barcode labels for products or for a whole imported delivery.',
          },
          replay: {
            title: 'Help is here',
            description: 'Replay this tour or contact support from this button anytime.',
          },
        },
      },
      pos: {
        title: 'POS',
        steps: {
          intro: {
            title: 'Welcome to POS',
            description:
              'Sell, bill, and get paid. Documents flow Quotation → Sales Order → Invoice → Delivery Order, and each converts into the next, so you never retype a line.',
          },
          search: {
            title: 'Find any document',
            description: 'Search by quotation, order, invoice, or delivery order number, or by customer name.',
          },
          quotation: {
            title: 'Quotations',
            description: 'Optional. Send a price offer, then convert it to an order or invoice when the customer agrees.',
          },
          order: {
            title: 'Sales orders',
            description: 'Confirm what the customer wants before billing. Handy when goods ship later or in parts.',
          },
          invoice: {
            title: 'Invoices',
            description: 'The bill. Record payments here; anything unpaid shows up in AR Aging.',
          },
          deliveryOrder: {
            title: 'Delivery orders',
            description: 'The paperwork for goods leaving. Create one from an invoice or sales order.',
          },
          customers: {
            title: 'Customers',
            description: 'Contacts, addresses, and statements for everyone you sell to.',
          },
          purchasing: {
            title: 'Purchasing & accounting',
            description:
              'Order stock from suppliers with purchase orders. The accounting books below are posted automatically from these documents.',
          },
          replay: {
            title: 'Help is here',
            description: 'Replay this tour or contact support from this button anytime.',
          },
        },
      },
      rms: {
        title: 'Workshop',
        steps: {
          intro: {
            title: 'Welcome to Workshop',
            description: 'Every vehicle’s service history in one place, plus reminders that bring customers back.',
          },
          search: {
            title: 'Look up a plate',
            description: 'Type a plate, model, VIN, or customer to jump straight to a vehicle’s history.',
          },
          vehicles: {
            title: 'Vehicles',
            description: 'Register each vehicle once with its owner. Its page holds the full service history.',
          },
          service: {
            title: 'Bill a service',
            description:
              'Open a vehicle and tap New invoice. Parts, labour, and the odometer reading are saved to that vehicle’s history.',
          },
          reminders: {
            title: 'Reminders',
            description:
              'Set a follow-up, like the next oil change, from a vehicle or invoice. Overdue and due-soon ones show up here and in your notifications.',
          },
          replay: {
            title: 'Help is here',
            description: 'Replay this tour or contact support from this button anytime.',
          },
        },
      },
      delivery: {
        title: 'Delivery',
        steps: {
          intro: {
            title: 'Welcome to Delivery',
            description: 'Plan who delivers what, let drivers work their route from a phone, and watch progress live.',
          },
          routes: {
            title: 'Routes',
            description:
              'Each team has one driver and one route per day. Add stops from delivery orders or customers, then optimize the order.',
          },
          driverApp: {
            title: 'The driver’s side',
            description: 'Drivers log in on their phone, follow their stops, and confirm each delivery with a proof photo.',
          },
          monitoring: {
            title: 'Monitoring',
            description: 'Today’s progress across all drivers, updated live.',
          },
          drivers: {
            title: 'Drivers',
            description: 'Approve driver phones, lock accounts, and set working hours.',
          },
          replay: {
            title: 'Help is here',
            description: 'Replay this tour or contact support from this button anytime.',
          },
        },
      },
    },
  },
  id: {
    tour: {
      next: 'Lanjut',
      back: 'Kembali',
      finish: 'Selesai',
      skip: 'Lewati tutorial',
      counter: 'Langkah {current} dari {total}',
      chip: 'Tur {module}',
      prompt: {
        eyebrow: 'Tur singkat · sekitar 1 menit',
        title: 'Baru di {module}?',
        pageEyebrow: 'Tur halaman · kurang dari semenit',
        pageTitle: 'Tur {module}?',
        pageBody: 'Penjelasan singkat fungsi tiap bagian di halaman ini.',
        body: 'Ikuti tur singkat untuk mempelajari cara kerja modul ini.',
        start: 'Mulai tutorial',
        later: 'Nanti saja',
      },
      help: {
        label: 'Bantuan',
        sidebarLabel: 'Bantuan & tutorial',
        tutorial: 'Tutorial {module}',
        tutorialHint: 'Tur terpandu 1 menit',
        tutorialDone: 'Selesai · ulangi kapan saja',
        support: 'Hubungi dukungan',
        supportHint: 'Chat dengan kami di WhatsApp',
        newBadge: 'Baru',
        cardTitle: 'Tur {module}',
        cardHint: 'Pelajari modul ini dalam semenit',
        cardDoneHint: 'Ulangi tur atau minta bantuan',
        pageTour: 'Tur halaman ini',
        pageCardTitle: 'Tur halaman ini',
      },
      pages: tourPages.id,
      done: {
        title: 'Tur {module} selesai',
        body: 'Ulangi kapan saja dari Bantuan.',
      },
      ops: {
        title: 'OPS',
        steps: {
          intro: {
            title: 'Selamat datang di OPS',
            description:
              'Pusat pemindaian gudang Anda. Setiap pergerakan stok (terima, ambil, pindah, retur) dilakukan dalam sesi: mulai sesi, pindai barang, lalu selesaikan setelah semuanya beres.',
          },
          search: {
            title: 'Cari apa saja',
            description: 'Ketik atau pindai SKU, produk, atau lokasi untuk melihat letak barang dan riwayat pindaiannya.',
          },
          pendingOrders: {
            title: 'Pesanan menunggu',
            description: 'Pesanan yang diimpor muncul di sini, siap untuk dipenuhi.',
          },
          modes: {
            title: 'Mulai sesi',
            description:
              'Pilih yang sedang Anda kerjakan: Terima, Retur, Pindah, atau Penuhi. Lalu pindai saja. Pengambilan, pemindahan, dan retur langsung memperbarui stok saat dipindai.',
          },
          receive: {
            title: 'Penerimaan dimulai dari impor',
            description:
              'Admin mengimpor lembar kiriman (ini yang menambah stok) dan mencetak labelnya. Pilih kiriman itu di sini dan pindai untuk memeriksa barang yang benar-benar datang.',
          },
          sessions: {
            title: 'Lanjutkan pekerjaan',
            description: 'Sesi yang masih terbuka ada di sini sampai diselesaikan. Lihat semua untuk riwayat lengkap.',
          },
          labels: {
            title: 'Label',
            description: 'Cetak label barcode untuk produk atau untuk seluruh kiriman yang diimpor.',
          },
          replay: {
            title: 'Bantuan ada di sini',
            description: 'Ulangi tur ini atau hubungi dukungan dari tombol ini kapan saja.',
          },
        },
      },
      pos: {
        title: 'POS',
        steps: {
          intro: {
            title: 'Selamat datang di POS',
            description:
              'Jual, tagih, dan terima pembayaran. Dokumen mengalir Penawaran → Pesanan Penjualan → Faktur → Surat Jalan, dan masing-masing bisa dikonversi ke tahap berikutnya tanpa mengetik ulang.',
          },
          search: {
            title: 'Cari dokumen apa saja',
            description: 'Cari berdasarkan nomor penawaran, pesanan, faktur, atau surat jalan, atau nama pelanggan.',
          },
          quotation: {
            title: 'Penawaran',
            description: 'Opsional. Kirim penawaran harga, lalu konversi ke pesanan atau faktur saat pelanggan setuju.',
          },
          order: {
            title: 'Pesanan penjualan',
            description: 'Konfirmasi kebutuhan pelanggan sebelum menagih. Berguna jika barang dikirim belakangan atau bertahap.',
          },
          invoice: {
            title: 'Faktur',
            description: 'Tagihannya. Catat pembayaran di sini; yang belum lunas muncul di Umur Piutang.',
          },
          deliveryOrder: {
            title: 'Surat jalan',
            description: 'Dokumen untuk barang yang keluar. Buat dari faktur atau pesanan penjualan.',
          },
          customers: {
            title: 'Pelanggan',
            description: 'Kontak, alamat, dan laporan tagihan untuk semua pelanggan Anda.',
          },
          purchasing: {
            title: 'Pembelian & akuntansi',
            description:
              'Pesan stok dari pemasok dengan pesanan pembelian. Pembukuan akuntansi di bawahnya tercatat otomatis dari dokumen-dokumen ini.',
          },
          replay: {
            title: 'Bantuan ada di sini',
            description: 'Ulangi tur ini atau hubungi dukungan dari tombol ini kapan saja.',
          },
        },
      },
      rms: {
        title: 'Bengkel',
        steps: {
          intro: {
            title: 'Selamat datang di Bengkel',
            description: 'Riwayat servis setiap kendaraan di satu tempat, plus pengingat agar pelanggan kembali.',
          },
          search: {
            title: 'Cari pelat nomor',
            description: 'Ketik pelat, model, VIN, atau pelanggan untuk langsung membuka riwayat kendaraan.',
          },
          vehicles: {
            title: 'Kendaraan',
            description: 'Daftarkan setiap kendaraan sekali beserta pemiliknya. Halamannya menyimpan seluruh riwayat servis.',
          },
          service: {
            title: 'Tagih servis',
            description:
              'Buka kendaraan dan ketuk Faktur baru. Suku cadang, jasa, dan angka odometer tersimpan di riwayat kendaraan itu.',
          },
          reminders: {
            title: 'Pengingat',
            description:
              'Buat tindak lanjut, misalnya ganti oli berikutnya, dari kendaraan atau faktur. Yang terlambat dan segera jatuh tempo muncul di sini dan di notifikasi.',
          },
          replay: {
            title: 'Bantuan ada di sini',
            description: 'Ulangi tur ini atau hubungi dukungan dari tombol ini kapan saja.',
          },
        },
      },
      delivery: {
        title: 'Pengiriman',
        steps: {
          intro: {
            title: 'Selamat datang di Pengiriman',
            description: 'Atur siapa mengantar apa, biarkan driver menjalankan rutenya dari ponsel, dan pantau progresnya secara langsung.',
          },
          routes: {
            title: 'Rute',
            description:
              'Setiap tim punya satu driver dan satu rute per hari. Tambahkan pemberhentian dari surat jalan atau pelanggan, lalu optimalkan urutannya.',
          },
          driverApp: {
            title: 'Sisi driver',
            description: 'Driver masuk lewat ponsel, mengikuti pemberhentiannya, dan mengonfirmasi setiap pengiriman dengan foto bukti.',
          },
          monitoring: {
            title: 'Pemantauan',
            description: 'Progres hari ini untuk semua driver, diperbarui secara langsung.',
          },
          drivers: {
            title: 'Driver',
            description: 'Setujui ponsel driver, kunci akun, dan atur jam kerja.',
          },
          replay: {
            title: 'Bantuan ada di sini',
            description: 'Ulangi tur ini atau hubungi dukungan dari tombol ini kapan saja.',
          },
        },
      },
    },
  },
};
