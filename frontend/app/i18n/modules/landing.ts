// i18n strings for the public marketing/landing page (app/(site)/page.tsx).
// Only touches the top-level `landing` key: nav, hero, scanFeed (hero
// terminal), techMarquee, problem, features, howItWorks, ecosystem,
// whoItsFor, proof, faq, contact, and footer.

export const landing = {
  en: {
    landing: {
      nav: {
        products: 'Solutions',
        custom: 'Custom Apps',
        howItWorks: 'How it works',
        faq: 'FAQ',
        contact: 'Contact',
        bookDemo: 'Book a Demo',
        login: 'Login',
        toggleMenu: 'Toggle menu',
      },
      hero: {
        eyebrow: 'Software for real-world operations',
        headline: 'Business Operations, Simplified.',
        sub1: 'Software solutions designed to help businesses manage inventory, sales, workshops, and deliveries — all in one ecosystem.',
        ctaDemo: 'Book a Demo',
        ctaSolutions: 'Explore Solutions ↓',
        customLine: 'Need something different? We build custom apps too.',
        pauseAnimation: 'Pause animation',
        playAnimation: 'Play animation',
        platformLabel: 'Four solutions, one login',
        platformWarehouse: 'Warehouse',
        platformSales: 'Sales',
        platformWorkshop: 'Workshop',
        platformDelivery: 'Delivery',
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
      scene: {
        warehouse: 'Warehouse',
        sales: 'Sales',
        workshop: 'Workshop',
        delivery: 'Delivery',
        scanning: 'Scanning…',
        shelved: 'Shelved in',
        invoicing: 'Issuing invoice…',
        paid: 'Paid',
        loading: 'Loading the truck',
        onRoute: 'On route',
        delivered: 'Delivered',
        inService: 'In service · 40.000 km',
        serviceDone: 'Service complete',
        sku: 'SKU',
        item: 'Item',
        location: 'Location',
        qty: 'Qty',
        badgeReceive: 'RECEIVE',
        badgeMove: 'MOVE',
        badgeAdjust: 'ADJUST',
        dragHint: 'Drag to look around · hover a box',
        items: {
          waterGallon: 'Water gallon 19L',
          oilFilter: 'Oil filter',
          beverageCase: 'Beverage case',
          brakePads: 'Brake pad set',
          packaging: 'Packaging cartons',
          engineOil: 'Engine oil 1L',
          timingBelt: 'Timing belt',
          sparkPlug: 'Spark plug',
          wheelBearing: 'Wheel bearing',
        },
      },
      techMarquee: {
        tags: {
          barcodeScanning: 'BARCODE SCANNING',
          invoicing: 'INVOICING',
          workOrders: 'WORK ORDERS',
          routePlanning: 'ROUTE PLANNING',
          proofOfDelivery: 'PROOF OF DELIVERY',
          realTimeSync: 'REAL-TIME SYNC',
          roleBasedAccess: 'ROLE-BASED ACCESS',
          auditTrail: 'AUDIT TRAIL',
          multiLocationTracking: 'MULTI-LOCATION TRACKING',
        },
      },
      problem: {
        eyebrow: 'Sound familiar?',
        heading: 'Still running your business on Excel, paper, and WhatsApp?',
        cards: {
          mismatch: {
            title: 'Stock doesn’t match',
            body: 'Manual entries create mistakes, and nobody knows which number is right.',
          },
          invoices: {
            title: 'Invoices slip through',
            body: 'Sales, payments, and what’s still owed live in different places.',
          },
          jobs: {
            title: 'Jobs live on a whiteboard',
            body: 'Who’s working on what, and which parts it used, gets lost.',
          },
          deliveries: {
            title: 'Nobody knows where the delivery is',
            body: 'Your team finds out by calling the driver.',
          },
        },
        mockLog: {
          fileLabel: 'manual-tracker.xlsx — unsaved',
        },
        visual: {
          mismatch: 'Mismatch — last seen Bay 7',
          chatSender: 'Budi (Warehouse)',
          chatMessage: 'Has that order reached the customer yet??',
          chatTime: '2 days ago',
          note: 'Recount on Friday?',
        },
        bridge: 'There’s a better way.',
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
        visual: {
          receivedToday: 'Received today',
          scan: 'Scan',
          imported: 'SKUs imported',
          roleAdmin: 'Admin',
          roleStaff: 'Staff',
          roleDriver: 'Driver',
        },
      },
      howItWorks: {
        eyebrow: 'How it connects',
        heading: 'One system, from stock to customer.',
        steps: {
          warehouse: {
            title: 'Stock comes in',
            body: 'Goods are scanned on arrival, so everyone sees what you have and where it is.',
          },
          sales: {
            title: 'The sale is recorded',
            body: 'Issuing an invoice takes the goods out of stock and tracks what’s been paid.',
          },
          delivery: {
            title: 'The order goes out',
            body: 'Delivery orders go onto a route, and each driver reports from their phone.',
          },
          workshop: {
            title: 'The workshop stays in sync',
            body: 'Parts on a work order are held from stock, then billed on one invoice.',
          },
        },
      },
      ecosystem: {
        eyebrow: 'Our solutions',
        heading: 'Four solutions. One ecosystem.',
        sub: 'Use the one your business needs today. Each is built for its own kind of work, and they all work together.',
        hubCaption: 'One login. One source of truth.',
        products: {
          warehouse: { tag: 'Inventory & warehouse management' },
          sales: { tag: 'Sales & invoicing' },
          workshop: { tag: 'Automotive workshop management' },
          delivery: { tag: 'Delivery & route management' },
        },
      },
      solutions: {
        warehouse: {
          audience: 'For spare-parts businesses, distributors, wholesalers, and retailers',
          title: 'Know every part, every shelf, every movement.',
          body: 'Built around real spare-parts operations, where thousands of SKUs move every day. Scan goods in, move them between locations, and always know what you have and where it is.',
        },
        sales: {
          audience: 'For businesses that sell and invoice',
          title: 'From quotation to paid invoice.',
          body: 'Quote, take the order, invoice it, and see what’s been paid and what you actually earned, without retyping anything between steps.',
          features: {
            documents: { title: 'Quotations to invoices', body: 'One flow from quotation to sales order to invoice.' },
            payments: { title: 'Split payments', body: 'Take one invoice across several payment methods.' },
            tax: { title: 'Tax report', body: 'A clear, printable report for your tax administrator.' },
            margin: { title: 'Margin reports', body: 'See the profit on what you sell, not only the revenue.' },
          },
          mock: {
            paid: 'Paid',
            line1: 'Goods',
            line2: 'Delivery & service',
            total: 'Total',
            transfer: 'Transfer',
            cash: 'Cash',
          },
        },
        workshop: {
          audience: 'For automotive workshops',
          title: 'Run your bays, not your paperwork.',
          body: 'Made for automotive workshops: every vehicle, job, mechanic, and part in one place, from the moment a car rolls in until the customer pays.',
          features: {
            workOrders: { title: 'Work orders', body: 'Track each job from intake to invoice, parts included.' },
            vehicles: { title: 'Vehicle history', body: 'Every plate’s customer and service record, a search away.' },
            mechanic: { title: 'Mechanic app', body: 'Mechanics see and update their jobs from their phone.' },
            reminders: { title: 'Service reminders', body: 'Know which customers are due back for service.' },
          },
          mock: {
            status: 'In progress',
            job: 'Periodic service',
            part1: 'Oil filter',
            part2: 'Engine oil',
            next: 'Next service',
          },
        },
        delivery: {
          audience: 'For water distributors, logistics operators, and delivery businesses',
          title: 'Plan the route. Follow every drop.',
          body: 'Made for businesses with drivers on the road every day: plan better routes, dispatch them in minutes, and know what arrived.',
          features: {
            routes: { title: 'Route planning', body: 'Put stops in an efficient order, then adjust by hand.' },
            driver: { title: 'Driver app', body: 'Drivers get their stops and navigation on their phone.' },
            monitoring: { title: 'Delivery monitoring', body: 'See every route’s progress from the office.' },
            proof: { title: 'Proof of delivery', body: 'A photo from the driver confirms each drop.' },
          },
          mock: {
            stop1: 'Toko Makmur',
            stop2: 'Depot Sejahtera',
            stop3: 'CV Berkah Jaya',
            stop4: 'Warung Bu Sari',
          },
        },
      },
      custom: {
        eyebrow: 'Custom apps',
        heading: 'Need something built just for you?',
        body: 'Not every business fits a standard product. Tell us how yours works, and we’ll design and build software around it, on its own or connected to your WareSys solutions.',
        cta: 'Tell Us What You Need',
        offers: {
          apps: { title: 'Custom apps', body: 'Web and mobile apps built around how your team works.' },
          integrations: { title: 'Integrations', body: 'Connect WareSys to the systems you already use.' },
          workflows: { title: 'Custom workflows', body: 'Your approvals, rules, and processes, built in.' },
          reports: { title: 'Reports & documents', body: 'The reports and printed forms your business needs.' },
        },
      },
      whoItsFor: {
        eyebrow: "Who it's for",
        heading: 'Built for businesses that keep things moving.',
        cards: {
          distributors: {
            title: 'Distributors & Wholesalers',
            body: 'Keep stock, orders, and deliveries in step across every location.',
          },
          spareParts: {
            title: 'Spare Parts Shops & Retailers',
            body: 'Track thousands of SKUs without losing location visibility, and sell from live stock.',
          },
          workshops: {
            title: 'Automotive Workshops',
            body: 'Know which parts are available before starting a job, and bill it all on one invoice.',
          },
          logistics: {
            title: 'Water Distributors & Logistics',
            body: 'Plan daily routes, dispatch drivers, and confirm every drop.',
          },
        },
        footNote: 'Don’t see your business here? We also build custom apps around how you work.',
      },
      proof: {
        eyebrow: 'Why WareSys',
        heading: 'Built for how operations really run.',
        cards: {
          connected: {
            title: 'Everything stays connected.',
            body: 'Your teams work from the same data, not their own spreadsheets.',
          },
          whoDid: {
            title: 'Know who did what.',
            body: 'Every important action is recorded with a name and a time.',
          },
          modular: {
            title: 'Start with what you need.',
            body: 'Activate one solution now and add others as you grow.',
          },
          quickStart: {
            title: 'Get started without months of setup.',
            body: 'Import your existing data and start using it.',
          },
        },
      },
      faq: {
        eyebrow: 'Common questions',
        heading: 'What owners usually ask.',
        stillQuestions: 'Still have questions?',
        stillQuestionsBody: 'Talk to us directly — we reply the same day.',
        contactCta: 'Contact us',
        items: {
          whatDoesItDo: {
            q: 'What does WareSys actually do?',
            a: 'WareSys is business software with four solutions: Warehouse for inventory, Invoice POS for sales, Workshop RMS for automotive workshops, and Delivery DMS for routes and drivers. They replace scattered spreadsheets, paper, and chat groups.',
          },
          needAll: {
            q: 'Do I need all four solutions?',
            a: 'No. Start with the one that fits your business and add others later. They share one login and work together when you use more than one.',
          },
          custom: {
            q: 'Can you build something custom for my business?',
            a: 'Yes. Beyond the four solutions, we build custom apps, integrations, and workflows. Tell us what you need and we’ll scope it with you.',
          },
          multipleEmployees: {
            q: 'Can multiple employees use it?',
            a: 'Yes. Each employee gets their own login. Admins see everything; staff see what they need.',
          },
          multiLocation: {
            q: 'Does it work across multiple locations?',
            a: 'Yes. Stock is tracked per warehouse and shelf, and every transfer is logged so you always know where something went.',
          },
          getStarted: {
            q: 'How do I get started?',
            a: 'Book a demo below. We will set up your account, import your existing data, and get your team trained.',
          },
        },
      },
      contact: {
        eyebrow: '// Get in touch',
        heading: 'Ready to simplify your operations?',
        sub: 'Book a demo or ask about a custom app. We will get back to you the same day.',
        whatsapp: {
          sub: 'Fastest response',
        },
        email: {
          title: 'Email us',
        },
      },
      footer: {
        tagline: 'Business Operations, Simplified.',
        product: 'Product',
        contact: 'Contact',
        language: 'Language',
      },
    },
  },
  id: {
    landing: {
      nav: {
        products: 'Solusi',
        custom: 'Aplikasi Kustom',
        howItWorks: 'Cara Kerja',
        faq: 'Pertanyaan Umum',
        contact: 'Kontak',
        bookDemo: 'Jadwalkan Demo',
        login: 'Masuk',
        toggleMenu: 'Buka menu',
      },
      hero: {
        eyebrow: 'Software untuk operasional sehari-hari',
        headline: 'Operasional Bisnis, Jadi Lebih Sederhana.',
        sub1: 'Solusi software yang membantu bisnis mengelola inventaris, penjualan, bengkel, dan pengiriman — semua dalam satu ekosistem.',
        ctaDemo: 'Jadwalkan Demo',
        ctaSolutions: 'Lihat Solusi ↓',
        customLine: 'Butuh yang berbeda? Kami juga membuat aplikasi kustom.',
        pauseAnimation: 'Jeda animasi',
        playAnimation: 'Putar animasi',
        platformLabel: 'Empat solusi, satu login',
        platformWarehouse: 'Gudang',
        platformSales: 'Penjualan',
        platformWorkshop: 'Bengkel',
        platformDelivery: 'Pengiriman',
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
      scene: {
        warehouse: 'Gudang',
        sales: 'Penjualan',
        workshop: 'Bengkel',
        delivery: 'Pengiriman',
        scanning: 'Memindai…',
        shelved: 'Disimpan di',
        invoicing: 'Menerbitkan faktur…',
        paid: 'Lunas',
        loading: 'Memuat ke truk',
        onRoute: 'Dalam perjalanan',
        delivered: 'Terkirim',
        inService: 'Diservis · 40.000 km',
        serviceDone: 'Servis selesai',
        sku: 'SKU',
        item: 'Barang',
        location: 'Lokasi',
        qty: 'Jml',
        badgeReceive: 'TERIMA',
        badgeMove: 'PINDAH',
        badgeAdjust: 'KOREKSI',
        dragHint: 'Geser untuk melihat · arahkan ke kotak',
        items: {
          waterGallon: 'Galon air 19L',
          oilFilter: 'Filter oli',
          beverageCase: 'Dus minuman',
          brakePads: 'Set kampas rem',
          packaging: 'Karton kemasan',
          engineOil: 'Oli mesin 1L',
          timingBelt: 'Timing belt',
          sparkPlug: 'Busi',
          wheelBearing: 'Bearing roda',
        },
      },
      techMarquee: {
        tags: {
          barcodeScanning: 'PEMINDAIAN BARCODE',
          invoicing: 'FAKTUR',
          workOrders: 'WORK ORDER',
          routePlanning: 'PERENCANAAN RUTE',
          proofOfDelivery: 'BUKTI PENGIRIMAN',
          realTimeSync: 'SINKRONISASI REAL-TIME',
          roleBasedAccess: 'AKSES BERBASIS PERAN',
          auditTrail: 'JEJAK AUDIT',
          multiLocationTracking: 'PELACAKAN MULTI-LOKASI',
        },
      },
      problem: {
        eyebrow: 'Terdengar familiar?',
        heading: 'Bisnis Anda masih jalan pakai Excel, kertas, dan WhatsApp?',
        cards: {
          mismatch: {
            title: 'Stok tidak sesuai',
            body: 'Input manual menimbulkan kesalahan, dan tidak ada yang tahu angka mana yang benar.',
          },
          invoices: {
            title: 'Faktur terlewat',
            body: 'Penjualan, pembayaran, dan sisa tagihan tercatat di tempat yang berbeda-beda.',
          },
          jobs: {
            title: 'Pekerjaan bengkel cuma di papan tulis',
            body: 'Siapa mengerjakan apa, dan suku cadang apa yang dipakai, jadi tidak terlacak.',
          },
          deliveries: {
            title: 'Tidak ada yang tahu posisi kiriman',
            body: 'Tim Anda baru tahu setelah menelepon pengemudi.',
          },
        },
        mockLog: {
          fileLabel: 'pelacak-manual.xlsx — belum disimpan',
        },
        visual: {
          mismatch: 'Tidak cocok — terakhir di Bay 7',
          chatSender: 'Budi (Gudang)',
          chatMessage: 'Pesanan itu sudah sampai ke pelanggan belum??',
          chatTime: '2 hari lalu',
          note: 'Hitung ulang hari Jumat?',
        },
        bridge: 'Ada cara yang lebih baik.',
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
        visual: {
          receivedToday: 'Diterima hari ini',
          scan: 'Pindai',
          imported: 'SKU diimpor',
          roleAdmin: 'Admin',
          roleStaff: 'Staf',
          roleDriver: 'Pengemudi',
        },
      },
      howItWorks: {
        eyebrow: 'Cara terhubungnya',
        heading: 'Satu sistem, dari stok sampai ke pelanggan.',
        steps: {
          warehouse: {
            title: 'Stok masuk',
            body: 'Barang dipindai saat tiba, sehingga semua orang tahu apa yang ada dan di mana lokasinya.',
          },
          sales: {
            title: 'Penjualan tercatat',
            body: 'Menerbitkan faktur langsung mengurangi stok dan melacak yang sudah dibayar.',
          },
          delivery: {
            title: 'Pesanan dikirim',
            body: 'Surat jalan masuk ke rute, dan setiap pengemudi melapor dari ponselnya.',
          },
          workshop: {
            title: 'Bengkel tetap sinkron',
            body: 'Suku cadang di work order ditahan dari stok, lalu ditagih dalam satu faktur.',
          },
        },
      },
      ecosystem: {
        eyebrow: 'Solusi kami',
        heading: 'Empat solusi. Satu ekosistem.',
        sub: 'Pakai yang dibutuhkan bisnis Anda hari ini. Masing-masing dibuat untuk jenis pekerjaannya sendiri, dan semuanya saling terhubung.',
        hubCaption: 'Satu login. Satu sumber data.',
        products: {
          warehouse: { tag: 'Manajemen inventaris & gudang' },
          sales: { tag: 'Penjualan & faktur' },
          workshop: { tag: 'Manajemen bengkel otomotif' },
          delivery: { tag: 'Manajemen pengiriman & rute' },
        },
      },
      solutions: {
        warehouse: {
          audience: 'Untuk bisnis suku cadang, distributor, grosir, dan ritel',
          title: 'Tahu setiap barang, setiap rak, setiap pergerakan.',
          body: 'Dibuat dari operasional suku cadang yang sesungguhnya, dengan ribuan SKU yang bergerak setiap hari. Pindai barang masuk, pindahkan antar lokasi, dan selalu tahu apa yang Anda miliki dan di mana lokasinya.',
        },
        sales: {
          audience: 'Untuk bisnis yang menjual dan menerbitkan faktur',
          title: 'Dari penawaran sampai faktur lunas.',
          body: 'Buat penawaran, terima pesanan, terbitkan faktur, lalu lihat yang sudah dibayar dan untung sebenarnya, tanpa mengetik ulang di tiap langkah.',
          features: {
            documents: { title: 'Penawaran sampai faktur', body: 'Satu alur dari penawaran, pesanan penjualan, hingga faktur.' },
            payments: { title: 'Pembayaran terpisah', body: 'Terima satu faktur dengan beberapa metode pembayaran.' },
            tax: { title: 'Laporan pajak', body: 'Laporan jelas yang siap dicetak untuk admin pajak Anda.' },
            margin: { title: 'Laporan margin', body: 'Lihat keuntungan dari yang Anda jual, bukan hanya omzetnya.' },
          },
          mock: {
            paid: 'Lunas',
            line1: 'Barang',
            line2: 'Pengiriman & jasa',
            total: 'Total',
            transfer: 'Transfer',
            cash: 'Tunai',
          },
        },
        workshop: {
          audience: 'Untuk bengkel otomotif',
          title: 'Urus bengkelnya, bukan kertasnya.',
          body: 'Dibuat untuk bengkel otomotif: setiap kendaraan, pekerjaan, mekanik, dan suku cadang di satu tempat, sejak mobil masuk sampai pelanggan membayar.',
          features: {
            workOrders: { title: 'Work order', body: 'Lacak setiap pekerjaan dari masuk hingga faktur, termasuk suku cadangnya.' },
            vehicles: { title: 'Riwayat kendaraan', body: 'Data pelanggan dan riwayat servis setiap pelat, tinggal dicari.' },
            mechanic: { title: 'Aplikasi mekanik', body: 'Mekanik melihat dan memperbarui pekerjaannya dari ponsel.' },
            reminders: { title: 'Pengingat servis', body: 'Tahu pelanggan mana yang sudah waktunya servis lagi.' },
          },
          mock: {
            status: 'Dikerjakan',
            job: 'Servis berkala',
            part1: 'Filter oli',
            part2: 'Oli mesin',
            next: 'Servis berikutnya',
          },
        },
        delivery: {
          audience: 'Untuk distributor air, operator logistik, dan bisnis pengiriman',
          title: 'Rencanakan rute. Pantau setiap kiriman.',
          body: 'Dibuat untuk bisnis dengan pengemudi di jalan setiap hari: susun rute lebih baik, tugaskan dalam hitungan menit, dan tahu apa yang sudah sampai.',
          features: {
            routes: { title: 'Perencanaan rute', body: 'Susun urutan pemberhentian yang efisien, lalu sesuaikan manual.' },
            driver: { title: 'Aplikasi pengemudi', body: 'Pengemudi mendapat daftar pemberhentian dan navigasi di ponsel.' },
            monitoring: { title: 'Pemantauan pengiriman', body: 'Lihat progres setiap rute dari kantor.' },
            proof: { title: 'Bukti pengiriman', body: 'Foto dari pengemudi mengonfirmasi setiap kiriman.' },
          },
          mock: {
            stop1: 'Toko Makmur',
            stop2: 'Depot Sejahtera',
            stop3: 'CV Berkah Jaya',
            stop4: 'Warung Bu Sari',
          },
        },
      },
      custom: {
        eyebrow: 'Aplikasi kustom',
        heading: 'Butuh yang dibuat khusus untuk Anda?',
        body: 'Tidak semua bisnis cocok dengan produk standar. Ceritakan cara kerja bisnis Anda, dan kami akan merancang serta membuat software sesuai kebutuhan, berdiri sendiri atau terhubung dengan solusi WareSys Anda.',
        cta: 'Ceritakan Kebutuhan Anda',
        offers: {
          apps: { title: 'Aplikasi kustom', body: 'Aplikasi web dan mobile sesuai cara kerja tim Anda.' },
          integrations: { title: 'Integrasi', body: 'Hubungkan WareSys dengan sistem yang sudah Anda pakai.' },
          workflows: { title: 'Alur kerja kustom', body: 'Persetujuan, aturan, dan proses Anda, langsung di sistem.' },
          reports: { title: 'Laporan & dokumen', body: 'Laporan dan formulir cetak yang dibutuhkan bisnis Anda.' },
        },
      },
      whoItsFor: {
        eyebrow: 'Untuk siapa',
        heading: 'Dibuat untuk bisnis yang terus bergerak.',
        cards: {
          distributors: {
            title: 'Distributor & Grosir',
            body: 'Selaraskan stok, pesanan, dan pengiriman di setiap lokasi.',
          },
          spareParts: {
            title: 'Toko Suku Cadang & Ritel',
            body: 'Lacak ribuan SKU tanpa kehilangan visibilitas lokasi, dan jual dari stok real-time.',
          },
          workshops: {
            title: 'Bengkel Otomotif',
            body: 'Ketahui suku cadang yang tersedia sebelum memulai pekerjaan, dan tagih semuanya dalam satu faktur.',
          },
          logistics: {
            title: 'Distributor Air & Logistik',
            body: 'Rencanakan rute harian, tugaskan pengemudi, dan konfirmasi setiap kiriman.',
          },
        },
        footNote: 'Bisnis Anda tidak ada di sini? Kami juga membuat aplikasi kustom sesuai cara kerja Anda.',
      },
      proof: {
        eyebrow: 'Mengapa WareSys',
        heading: 'Dibuat sesuai cara operasional berjalan.',
        cards: {
          connected: {
            title: 'Semuanya tetap terhubung.',
            body: 'Tim Anda bekerja dari data yang sama, bukan spreadsheet masing-masing.',
          },
          whoDid: {
            title: 'Tahu siapa melakukan apa.',
            body: 'Setiap aksi penting tercatat dengan nama dan waktunya.',
          },
          modular: {
            title: 'Mulai dari yang Anda butuhkan.',
            body: 'Aktifkan satu solusi sekarang dan tambah yang lain seiring bisnis tumbuh.',
          },
          quickStart: {
            title: 'Mulai tanpa perlu berbulan-bulan setup.',
            body: 'Impor data yang sudah ada dan langsung gunakan.',
          },
        },
      },
      faq: {
        eyebrow: 'Pertanyaan umum',
        heading: 'Yang biasa ditanyakan pemilik usaha.',
        stillQuestions: 'Masih punya pertanyaan?',
        stillQuestionsBody: 'Hubungi kami langsung — kami balas di hari yang sama.',
        contactCta: 'Hubungi kami',
        items: {
          whatDoesItDo: {
            q: 'Sebenarnya WareSys itu untuk apa?',
            a: 'WareSys adalah software bisnis dengan empat solusi: Warehouse untuk inventaris, Invoice POS untuk penjualan, Workshop RMS untuk bengkel otomotif, dan Delivery DMS untuk rute dan pengemudi. Semuanya menggantikan spreadsheet, kertas, dan grup chat yang tercecer.',
          },
          needAll: {
            q: 'Apakah saya harus memakai keempat solusi?',
            a: 'Tidak. Mulai dari yang cocok untuk bisnis Anda dan tambah yang lain nanti. Semuanya memakai satu login dan saling terhubung saat Anda memakai lebih dari satu.',
          },
          custom: {
            q: 'Bisakah membuat aplikasi khusus untuk bisnis saya?',
            a: 'Bisa. Selain keempat solusi, kami membuat aplikasi kustom, integrasi, dan alur kerja. Ceritakan kebutuhan Anda dan kami akan membahas lingkupnya bersama Anda.',
          },
          multipleEmployees: {
            q: 'Bisa dipakai banyak karyawan sekaligus?',
            a: 'Bisa. Setiap karyawan punya login sendiri. Admin bisa melihat semuanya; staf melihat yang mereka butuhkan.',
          },
          multiLocation: {
            q: 'Apakah bisa untuk beberapa lokasi?',
            a: 'Bisa. Stok dilacak per gudang dan rak, dan setiap transfer tercatat sehingga Anda selalu tahu ke mana barang pergi.',
          },
          getStarted: {
            q: 'Bagaimana cara memulainya?',
            a: 'Jadwalkan demo di bawah ini. Kami akan menyiapkan akun Anda, mengimpor data yang ada, dan melatih tim Anda.',
          },
        },
      },
      contact: {
        eyebrow: '// Hubungi Kami',
        heading: 'Siap menyederhanakan operasional Anda?',
        sub: 'Jadwalkan demo atau tanyakan soal aplikasi kustom. Kami akan membalas di hari yang sama.',
        whatsapp: {
          sub: 'Respons tercepat',
        },
        email: {
          title: 'Kirim email',
        },
      },
      footer: {
        tagline: 'Operasional Bisnis, Jadi Lebih Sederhana.',
        product: 'Produk',
        contact: 'Kontak',
        language: 'Bahasa',
      },
    },
  },
};
