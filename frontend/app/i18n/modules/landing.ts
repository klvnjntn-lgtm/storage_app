// i18n strings for the public marketing/landing page (app/(site)/page.tsx).
// Only touches the top-level `landing` key: nav, hero, scanFeed (hero
// terminal), techMarquee, problem, features, howItWorks, ecosystem,
// whoItsFor, proof, faq, contact, and footer.

export const landing = {
  en: {
    landing: {
      nav: {
        howItWorks: 'How it works',
        faq: 'FAQ',
        contact: 'Contact',
        bookDemo: 'Book a Demo',
        login: 'Login',
        toggleMenu: 'Toggle menu',
      },
      hero: {
        eyebrow: 'Built for spare parts businesses',
        headline: 'Stop losing track of your spare parts.',
        sub1: 'WareSys keeps your inventory, locations, and stock movements in one place.',
        sub2: 'Scan parts. Move stock. Know exactly what you have and where it is.',
        ctaDemo: 'Book a Demo',
        ctaHowItWorks: 'See How It Works ↓',
      },
      scanFeed: {
        terminalLabel: 'warehouse@waresys — live feed',
        line1: 'Received 48x Brake Pad Set — Bay 3',
        line2: 'Transferred 12x Alternator — Bay 3 → Rack A2',
        line3: 'Scan match confirmed — SKU-88213',
        line4: 'Low stock alert — Timing Belt (Rack C1)',
        line5: 'User jdelacruz logged transfer #4471',
        line6: 'Received 20x Oil Filter — Bay 1',
        line7: 'Audit log exported by admin',
      },
      techMarquee: {
        tags: {
          barcodeScanning: 'BARCODE SCANNING',
          realTimeSync: 'REAL-TIME SYNC',
          roleBasedAccess: 'ROLE-BASED ACCESS',
          auditTrail: 'AUDIT TRAIL',
          multiLocationTracking: 'MULTI-LOCATION TRACKING',
          transferHistory: 'TRANSFER HISTORY',
          liveStockCounts: 'LIVE STOCK COUNTS',
        },
      },
      problem: {
        eyebrow: 'Sound familiar?',
        heading: 'Still managing stock with Excel, paper, or WhatsApp?',
        cards: {
          mismatch: {
            title: 'Stock doesn’t match',
            body: 'Manual entries create mistakes.',
          },
          disappear: {
            title: 'Parts disappear',
            body: 'You know something moved, but not who moved it.',
          },
          location: {
            title: 'Nobody knows the location',
            body: 'Your team wastes time searching shelves.',
          },
          forever: {
            title: 'Inventory takes forever',
            body: 'Counting and updating stock manually eats hours.',
          },
        },
        mockLog: {
          fileLabel: 'manual-tracker.xlsx — unsaved',
          line1: 'SKU-1042 · Bay 3 · qty 12',
          line2: 'mismatch — last seen Bay 7, qty 4',
          line3: '"did anyone move the brake pads??" — WhatsApp, 2 days ago',
          line4: 'stock count.FINAL.v3.xlsx — never opened again',
        },
      },
      features: {
        eyebrow: 'WareSys Warehouse',
        heading: 'Everything your stock team needs.',
        items: {
          barcodeReceiving: {
            label: 'Barcode receiving',
            sub: 'Scan on any device, instantly logged',
          },
          transfers: {
            label: 'Stock transfers',
            sub: 'Between locations with full history',
          },
          tracking: {
            label: 'Full inventory tracking',
            sub: 'Live counts per location',
          },
          multiUser: {
            label: 'Multi-user access with roles',
            sub: 'Admins and staff, separate views',
          },
          auditLogs: {
            label: 'Complete audit logs',
            sub: 'Every action timestamped',
          },
          onboarding: {
            label: 'Same-day onboarding',
            sub: 'Import your existing stock and go',
          },
        },
      },
      howItWorks: {
        eyebrow: 'How it works',
        heading: 'From the dock to the shelf.',
        steps: {
          receive: {
            title: 'Receive inventory',
            body: 'Scan or enter parts as they arrive. Every item is timestamped and assigned to a location immediately.',
          },
          move: {
            title: 'Move stock',
            body: 'Transfer parts between shelves or warehouses. The system records who moved what, and when.',
          },
          track: {
            title: 'Track everything',
            body: 'See live stock counts per location, pull audit logs, and know exactly what you have — and where.',
          },
        },
      },
      ecosystem: {
        eyebrow: 'The bigger picture',
        heading: 'One platform for your entire operation.',
        statusLive: 'Live',
        statusComingSoon: 'Coming soon',
        products: {
          warehouse: {
            tag: 'Inventory & warehouse management',
            body: 'Track stock, locations, transfers, and every movement.',
          },
          invoice: {
            tag: 'Sales & invoicing',
            body: 'Create invoices, manage products, track sales and calculate profit.',
          },
          workshop: {
            tag: 'Workshop management',
            body: 'Manage customers, vehicles, service history, reminders, invoices and workshop operations.',
          },
        },
      },
      whoItsFor: {
        eyebrow: "Who it's for",
        heading: 'Built for businesses that move parts every day.',
        cards: {
          spareParts: {
            title: 'Spare Parts Shops',
            body: 'Track thousands of SKUs without losing location visibility.',
          },
          workshops: {
            title: 'Automotive Workshops',
            body: 'Know what parts are available before starting a job.',
          },
          multiLocation: {
            title: 'Multi-Location Businesses',
            body: 'Move inventory between locations with a complete history.',
          },
        },
        footNote: 'If your inventory is still managed through Excel, paper, or memory, WareSys is built for you.',
      },
      proof: {
        eyebrow: 'Why WARESYS',
        heading: 'Built for real spare-parts operations.',
        cards: {
          location: {
            title: 'Know where every part is.',
            body: 'Track stock by warehouse, rack, shelf, or location.',
          },
          whoMoved: {
            title: 'Know who moved it.',
            body: 'Every stock movement is recorded.',
          },
          spreadsheets: {
            title: 'Stop relying on spreadsheets.',
            body: 'Your team works from the same inventory data.',
          },
          quickStart: {
            title: 'Get started without months of setup.',
            body: 'Import your existing stock and start using it.',
          },
        },
      },
      faq: {
        eyebrow: 'Common questions',
        heading: 'What owners usually ask.',
        items: {
          whatDoesItDo: {
            q: 'What does it actually do?',
            a: 'It replaces your spreadsheets. Receive parts, move them between locations, and see live stock counts — with a full history of every action.',
          },
          multipleEmployees: {
            q: 'Can multiple employees use it?',
            a: 'Yes. Each employee gets their own login. Admins see everything; staff see what they need.',
          },
          multiLocation: {
            q: 'Can I track stock across multiple locations?',
            a: 'Yes. Parts are tracked per shelf or warehouse. Every transfer is logged so you always know where a part went.',
          },
          getStarted: {
            q: 'How do I get started?',
            a: 'Book a demo below. We will set up your account, import your existing stock, and get your team trained in one session.',
          },
        },
      },
      contact: {
        eyebrow: '// Get in touch',
        heading: 'Ready to take control of your stock?',
        sub: 'Book a demo or reach out directly. We will get back to you the same day.',
        whatsapp: {
          sub: 'Fastest response',
        },
        email: {
          title: 'Email us',
        },
      },
      footer: {
        tagline: 'Built for spare parts businesses',
      },
    },
  },
  id: {
    landing: {
      nav: {
        howItWorks: 'Cara Kerja',
        faq: 'Pertanyaan Umum',
        contact: 'Kontak',
        bookDemo: 'Jadwalkan Demo',
        login: 'Masuk',
        toggleMenu: 'Buka menu',
      },
      hero: {
        eyebrow: 'Dibuat khusus untuk bisnis suku cadang',
        headline: 'Berhenti kehilangan jejak suku cadang Anda.',
        sub1: 'WareSys menyatukan inventaris, lokasi, dan pergerakan stok Anda dalam satu tempat.',
        sub2: 'Pindai suku cadang. Pindahkan stok. Ketahui persis apa yang Anda miliki dan di mana lokasinya.',
        ctaDemo: 'Jadwalkan Demo',
        ctaHowItWorks: 'Lihat Cara Kerjanya ↓',
      },
      scanFeed: {
        terminalLabel: 'warehouse@waresys — feed langsung',
        line1: 'Menerima 48x Set Kampas Rem — Bay 3',
        line2: 'Memindahkan 12x Alternator — Bay 3 → Rak A2',
        line3: 'Kecocokan pindaian dikonfirmasi — SKU-88213',
        line4: 'Peringatan stok menipis — Timing Belt (Rak C1)',
        line5: 'Pengguna jdelacruz mencatat transfer #4471',
        line6: 'Menerima 20x Filter Oli — Bay 1',
        line7: 'Log audit diekspor oleh admin',
      },
      techMarquee: {
        tags: {
          barcodeScanning: 'PEMINDAIAN BARCODE',
          realTimeSync: 'SINKRONISASI REAL-TIME',
          roleBasedAccess: 'AKSES BERBASIS PERAN',
          auditTrail: 'JEJAK AUDIT',
          multiLocationTracking: 'PELACAKAN MULTI-LOKASI',
          transferHistory: 'RIWAYAT TRANSFER',
          liveStockCounts: 'JUMLAH STOK REAL-TIME',
        },
      },
      problem: {
        eyebrow: 'Terdengar familiar?',
        heading: 'Masih mengelola stok pakai Excel, kertas, atau WhatsApp?',
        cards: {
          mismatch: {
            title: 'Stok tidak sesuai',
            body: 'Input manual menimbulkan kesalahan.',
          },
          disappear: {
            title: 'Suku cadang menghilang',
            body: 'Anda tahu sesuatu berpindah, tapi tidak tahu siapa yang memindahkannya.',
          },
          location: {
            title: 'Tidak ada yang tahu lokasinya',
            body: 'Tim Anda buang waktu mencari-cari di rak.',
          },
          forever: {
            title: 'Stock opname makan waktu lama',
            body: 'Menghitung dan memperbarui stok manual menghabiskan berjam-jam.',
          },
        },
        mockLog: {
          fileLabel: 'pelacak-manual.xlsx — belum disimpan',
          line1: 'SKU-1042 · Bay 3 · qty 12',
          line2: 'tidak cocok — terakhir terlihat Bay 7, qty 4',
          line3: '"ada yang mindahin kampas rem??" — WhatsApp, 2 hari lalu',
          line4: 'hitung stok.FINAL.v3.xlsx — tidak pernah dibuka lagi',
        },
      },
      features: {
        eyebrow: 'WareSys Warehouse',
        heading: 'Semua yang tim gudang Anda butuhkan.',
        items: {
          barcodeReceiving: {
            label: 'Penerimaan barcode',
            sub: 'Pindai di perangkat apa pun, langsung tercatat',
          },
          transfers: {
            label: 'Transfer stok',
            sub: 'Antar lokasi dengan riwayat lengkap',
          },
          tracking: {
            label: 'Pelacakan inventaris penuh',
            sub: 'Jumlah stok real-time per lokasi',
          },
          multiUser: {
            label: 'Akses multi-pengguna dengan peran',
            sub: 'Admin dan staf, tampilan terpisah',
          },
          auditLogs: {
            label: 'Log audit lengkap',
            sub: 'Setiap aksi tercatat waktunya',
          },
          onboarding: {
            label: 'Onboarding di hari yang sama',
            sub: 'Impor stok yang ada dan langsung jalan',
          },
        },
      },
      howItWorks: {
        eyebrow: 'Cara Kerja',
        heading: 'Dari dermaga bongkar muat sampai ke rak.',
        steps: {
          receive: {
            title: 'Terima inventaris',
            body: 'Pindai atau input suku cadang saat tiba. Setiap barang langsung tercatat waktu dan lokasinya.',
          },
          move: {
            title: 'Pindahkan stok',
            body: 'Transfer suku cadang antar rak atau gudang. Sistem mencatat siapa memindahkan apa, dan kapan.',
          },
          track: {
            title: 'Lacak semuanya',
            body: 'Lihat jumlah stok real-time per lokasi, tarik log audit, dan ketahui persis apa yang Anda miliki — dan di mana.',
          },
        },
      },
      ecosystem: {
        eyebrow: 'Gambaran yang lebih besar',
        heading: 'Satu platform untuk seluruh operasional Anda.',
        statusLive: 'Aktif',
        statusComingSoon: 'Segera hadir',
        products: {
          warehouse: {
            tag: 'Manajemen inventaris & gudang',
            body: 'Lacak stok, lokasi, transfer, dan setiap pergerakan.',
          },
          invoice: {
            tag: 'Penjualan & faktur',
            body: 'Buat faktur, kelola produk, lacak penjualan, dan hitung keuntungan.',
          },
          workshop: {
            tag: 'Manajemen bengkel',
            body: 'Kelola pelanggan, kendaraan, riwayat servis, pengingat, faktur, dan operasional bengkel.',
          },
        },
      },
      whoItsFor: {
        eyebrow: 'Untuk siapa',
        heading: 'Dibuat untuk bisnis yang memindahkan suku cadang setiap hari.',
        cards: {
          spareParts: {
            title: 'Toko Suku Cadang',
            body: 'Lacak ribuan SKU tanpa kehilangan visibilitas lokasi.',
          },
          workshops: {
            title: 'Bengkel Otomotif',
            body: 'Ketahui suku cadang yang tersedia sebelum memulai pekerjaan.',
          },
          multiLocation: {
            title: 'Bisnis Multi-Lokasi',
            body: 'Pindahkan inventaris antar lokasi dengan riwayat lengkap.',
          },
        },
        footNote: 'Jika inventaris Anda masih dikelola lewat Excel, kertas, atau ingatan, WareSys dibuat untuk Anda.',
      },
      proof: {
        eyebrow: 'Mengapa WARESYS',
        heading: 'Dibuat untuk operasional suku cadang yang sesungguhnya.',
        cards: {
          location: {
            title: 'Tahu persis di mana setiap suku cadang berada.',
            body: 'Lacak stok berdasarkan gudang, rak, atau lokasi.',
          },
          whoMoved: {
            title: 'Tahu siapa yang memindahkannya.',
            body: 'Setiap pergerakan stok tercatat.',
          },
          spreadsheets: {
            title: 'Berhenti bergantung pada spreadsheet.',
            body: 'Tim Anda bekerja dari data inventaris yang sama.',
          },
          quickStart: {
            title: 'Mulai tanpa perlu berbulan-bulan setup.',
            body: 'Impor stok yang sudah ada dan langsung gunakan.',
          },
        },
      },
      faq: {
        eyebrow: 'Pertanyaan umum',
        heading: 'Yang biasa ditanyakan pemilik usaha.',
        items: {
          whatDoesItDo: {
            q: 'Sebenarnya ini untuk apa?',
            a: 'Ini menggantikan spreadsheet Anda. Terima suku cadang, pindahkan antar lokasi, dan lihat jumlah stok secara real-time — dengan riwayat lengkap setiap aksi.',
          },
          multipleEmployees: {
            q: 'Bisa dipakai banyak karyawan sekaligus?',
            a: 'Bisa. Setiap karyawan punya login sendiri. Admin bisa melihat semuanya; staf melihat yang mereka butuhkan.',
          },
          multiLocation: {
            q: 'Bisakah melacak stok di beberapa lokasi sekaligus?',
            a: 'Bisa. Suku cadang dilacak per rak atau gudang. Setiap transfer tercatat sehingga Anda selalu tahu ke mana suku cadang itu pergi.',
          },
          getStarted: {
            q: 'Bagaimana cara memulainya?',
            a: 'Jadwalkan demo di bawah ini. Kami akan menyiapkan akun Anda, mengimpor stok yang ada, dan melatih tim Anda dalam satu sesi.',
          },
        },
      },
      contact: {
        eyebrow: '// Hubungi Kami',
        heading: 'Siap mengambil kendali penuh atas stok Anda?',
        sub: 'Jadwalkan demo atau hubungi kami langsung. Kami akan membalas di hari yang sama.',
        whatsapp: {
          sub: 'Respons tercepat',
        },
        email: {
          title: 'Kirim email',
        },
      },
      footer: {
        tagline: 'Dibuat untuk bisnis suku cadang',
      },
    },
  },
};
