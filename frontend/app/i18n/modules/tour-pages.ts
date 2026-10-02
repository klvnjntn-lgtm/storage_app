// Copy for the page tours (app/components/tour/pageTours.ts). Merged into
// tour.pages by tour.ts. Keep each step short: what it is, then what to do.
export const tourPages = {
  en: {
    // ── OPS / Warehouse ─────────────────────────────────────────────────
    opsSession: {
      title: 'Session',
      steps: {
        intro: { title: 'One piece of warehouse work', description: 'Scan items into this session; stock moves as you scan. Complete it when you’re done.' },
        stages: {
          title: 'Stages',
          description: 'Fulfilment runs Pick → (Pack) → Ship; a move runs Pick → Move. The highlighted stage is the one you’re scanning for.',
        },
        receiveCheck: {
          title: 'Receiving check',
          description: 'Expected (from the import) against counted, item by item. Differences are flagged so you can follow up with the supplier.',
        },
        scan: { title: 'Scan', description: 'Opens the scanner — phone camera or a USB barcode scanner.' },
        next: { title: 'Next stage', description: 'Move on when this stage is done. You can step back if you advanced too early.' },
        complete: {
          title: 'Complete',
          description: 'Closes the session. A move can only complete once everything picked has been put away.',
        },
        cancel: { title: 'Cancel', description: 'Only for sessions where no stock has moved yet. The reason goes into the notes.' },
        notes: { title: 'Notes', description: 'Leave a note for the team, e.g. a damaged box or a short delivery.' },
      },
    },
    opsLabels: {
      title: 'Labels',
      steps: {
        intro: { title: 'Print barcode labels', description: 'Every item needs a label before it can be scanned. Opened from a delivery, this lists one label per unit received.' },
        format: { title: 'Barcode or QR', description: 'Pick the code type your scanners read.' },
        settings: { title: 'Printer setup', description: 'Label size, printer resolution and offsets. Print an alignment test the first time.' },
        qty: { title: 'How many', description: 'Set how many labels to print for each item.' },
        itemPrint: { title: 'Print one item', description: 'Print just this item’s labels.' },
        printAll: { title: 'Print all', description: 'Print every item in the list (or every search match).' },
      },
    },
    // ── Workshop ────────────────────────────────────────────────────────
    rmsVehicles: {
      title: 'Vehicles',
      steps: {
        intro: { title: 'Every vehicle on file', description: 'Add a vehicle from its owner’s customer page; it appears here.' },
        search: { title: 'Search', description: 'By plate, model, VIN or customer.' },
        row: { title: 'Open a vehicle', description: 'See its full service history and start a new invoice.' },
      },
    },
    rmsVehicle: {
      title: 'Vehicle',
      steps: {
        intro: { title: 'The vehicle’s history', description: 'Every visit and what was done, newest first.' },
        newInvoice: { title: 'New invoice', description: 'Bill a service for this vehicle. Parts, labour and the odometer are saved to its history.' },
        stats: { title: 'At a glance', description: 'Total visits, last service and the latest odometer reading.' },
        filters: { title: 'Find a past job', description: 'Search parts or services, or show only drafts or issued invoices.' },
        visit: { title: 'A visit', description: 'Open it to see the invoice. Unfinished drafts can be resumed.' },
      },
    },
    rmsReminders: {
      title: 'Reminders',
      steps: {
        intro: { title: 'Bring customers back', description: 'Grouped into overdue, due soon and upcoming. Set them from a vehicle or an invoice.' },
        card: { title: 'A reminder', description: 'Which vehicle, what’s due and when. Tap to open the vehicle.' },
        complete: { title: 'Mark complete', description: 'Done — the customer came back or was contacted.' },
        snooze: { title: 'Snooze', description: 'Push it to a later date if the customer asked to wait.' },
      },
    },
    // ── POS / Sales ─────────────────────────────────────────────────────
    salesInvoiceNew: {
      title: 'New invoice',
      steps: {
        intro: { title: 'Ring up a sale', description: 'Find items, check the cart, then create and print. Your work is saved as a draft as you go.' },
        format: {
          title: 'Receipt or invoice',
          description: '58mm/80mm prints a quick receipt for walk-in sales. A5/A4 is a full invoice for a named customer, with due date and bank details.',
        },
        search: { title: 'Find items', description: 'Type or scan a name, SKU or OEM. Tap a result, set the quantity, then add it.' },
        location: { title: 'Stock location', description: 'Sell from one warehouse only, or let WareSys use the location with the most stock.' },
        customer: { title: 'Customer', description: 'Pick or quick-add a customer. Their price level is applied to new lines automatically.' },
        lines: { title: 'The cart', description: 'Change quantities, add a line discount or remove items. Totals update as you go.' },
        priceLevel: {
          title: 'Price level',
          description: 'Shows where each price comes from, e.g. “Wholesale — Rp100.000”. Change it per line if needed.',
        },
        submit: { title: 'Create & print', description: 'Issues the invoice and opens it for printing. It can’t be deleted after this — only edited or voided.' },
        history: { title: 'Past invoices', description: 'Find, reprint, take payment for or void earlier invoices.' },
      },
    },
    salesInvoiceEdit: {
      title: 'Edit issued invoice',
      steps: {
        intro: {
          title: 'Correct an issued invoice',
          description: 'Lines already on the invoice keep the price they were issued at. Every edit is recorded in the invoice’s history.',
        },
        reason: { title: 'Reason (required)', description: 'Say why it’s being changed, e.g. “customer returned 1 pc”. It’s shown in the edit history.' },
        lines: { title: 'Lines', description: 'Adjust quantities or discounts. Quantities can’t go below what has already shipped.' },
        search: { title: 'Add items', description: 'New lines are priced at the customer’s level.' },
        submit: { title: 'Save changes', description: 'Totals, stock and the books are updated together.' },
      },
    },
    salesInvoiceDetail: {
      title: 'Invoice',
      steps: {
        intro: { title: 'After the sale', description: 'Take payment, print, ship and follow up — all from here.' },
        pay: { title: 'Record a payment', description: 'Cash, transfer or partial payments. The status moves to Partial or Paid.' },
        print: { title: 'Print or download', description: 'Pick a format above, then print or save a PDF.' },
        toDelivery: { title: 'Delivery order', description: 'Create the delivery paperwork for goods leaving the warehouse.' },
        reminder: { title: 'Service reminder', description: 'Set a follow-up for this vehicle, like the next oil change.' },
        edit: { title: 'Edit', description: 'Correct the invoice with a reason. The change is kept in its history.' },
        void: {
          title: 'Void',
          description: 'Cancel an invoice made by mistake. Can’t be undone, needs a reason, and only works before any payment.',
        },
      },
    },
    salesQuotationNew: {
      title: 'New quotation',
      steps: {
        intro: { title: 'Offer a price', description: 'A quotation is optional. When the customer agrees, convert it to an order or invoice without retyping.' },
        customer: { title: 'Customer', description: 'Who the quote is for. Their price level is applied automatically.' },
        search: { title: 'Find items', description: 'Search by name, SKU or OEM and add them.' },
        lines: { title: 'Lines', description: 'Quantities, discounts and totals. You can also add services.' },
        priceLevel: { title: 'Price level', description: 'Where each price comes from. Change it per line if this customer gets a special price.' },
        submit: { title: 'Create & print', description: 'Saves the quotation and opens it for printing or PDF.' },
        history: { title: 'All quotations', description: 'Track sent, accepted and converted quotations.' },
      },
    },
    salesQuotationDetail: {
      title: 'Quotation',
      steps: {
        intro: { title: 'Follow it through', description: 'Draft → Sent → Accepted → converted. Only the buttons that apply right now are shown.' },
        edit: { title: 'Edit draft', description: 'Change items while it’s still a draft.' },
        send: { title: 'Mark as sent', description: 'Gives it its quotation number and marks it sent. Nothing is emailed — share the PDF yourself.' },
        accept: { title: 'Customer agreed', description: 'Record the customer’s answer: accept or reject.' },
        toOrder: { title: 'Convert to order', description: 'Becomes a sales order at the same prices — handy when goods ship later or in parts.' },
        toInvoice: { title: 'Convert to invoice', description: 'Bill straight away at the quoted prices.' },
        print: { title: 'Print or PDF', description: 'Print it or download a PDF to send.' },
      },
    },
    salesOrderNew: {
      title: 'New sales order',
      steps: {
        intro: { title: 'Confirm what they want', description: 'An order records what the customer ordered before billing.' },
        customer: { title: 'Customer', description: 'Required. Their price level is applied automatically.' },
        search: { title: 'Find items', description: 'Search by name, SKU or OEM and add them.' },
        lines: { title: 'Lines', description: 'Quantities, discounts and totals.' },
        priceLevel: { title: 'Price level', description: 'Where each price comes from. Change it per line if needed.' },
        submit: { title: 'Save order', description: 'Saves it as a draft. Confirm it from the order page.' },
      },
    },
    salesOrderDetail: {
      title: 'Sales order',
      steps: {
        intro: { title: 'Draft → confirmed → delivered → invoiced', description: 'Only the buttons that apply right now are shown.' },
        edit: { title: 'Edit draft', description: 'Change items while it’s still a draft.' },
        confirm: { title: 'Confirm', description: 'Locks the order in so it can be shipped and invoiced.' },
        deliveries: {
          title: 'Deliveries',
          description: 'Ship the order in one or more delivery orders, and record returns. The order tracks what has been delivered.',
        },
        toInvoice: { title: 'Invoice it', description: 'Bill the order at its saved prices.' },
        print: { title: 'Print or PDF', description: 'Print the order or download a PDF.' },
      },
    },
    // ── Delivery ─────────────────────────────────────────────────────────
    deliveryRoutes: {
      title: 'Delivery Routes',
      steps: {
        intro: {
          title: 'Plan the day here',
          description: 'Each team has one driver and one route per day. Pick a day, make a route for each team, then add stops.',
        },
        filters: { title: 'Pick the day', description: 'Routes are per day. Narrow the list by team or status.' },
        teams: {
          title: 'Teams',
          description: 'Create teams and set each team’s driver. Routes belong to the team; its driver works them.',
        },
        invite: { title: 'Invite a driver', description: 'Create a driver login with a temporary password. They sign in on their phone.' },
        newRoute: { title: 'New route', description: 'Make a route for a team on this day, then open it to add stops.' },
        optimizeAll: {
          title: 'Optimize all drivers',
          description: 'Let WareSys split the day’s deliveries across your drivers and put each route in order.',
        },
        list: { title: 'This day’s routes', description: 'Open a route to set its start point, add stops and optimize the order.' },
        drivers: { title: 'Drivers & access', description: 'Lock accounts, approve driver phones and set working hours.' },
      },
    },
    deliveryPlan: {
      title: 'Optimize all drivers',
      steps: {
        intro: {
          title: 'Plan every route at once',
          description: 'Pick the day, the teams and the deliveries. WareSys proposes routes — nothing is saved until you confirm.',
        },
        settings: {
          title: 'Day, time and depot',
          description: 'Choose the date, an optional departure time, and the depot drivers start from. Routes end at the last customer.',
        },
        teams: { title: 'Which drivers', description: 'Tick the teams to plan for. Routes already started are locked and left alone.' },
        deliveries: { title: 'Which deliveries', description: 'Tick the delivery orders to schedule today.' },
        preview: {
          title: 'Preview, then save',
          description: 'See the proposed routes on the map first. Anything that couldn’t fit is listed. Save when it looks right.',
        },
      },
    },
    deliveryRoute: {
      title: 'Route detail',
      steps: {
        intro: { title: 'One driver’s day', description: 'A start point, then stops in driving order.' },
        map: { title: 'The map', description: 'Every stop and the start point. It updates as stops change.' },
        start: { title: 'Start point', description: 'Where the driver leaves from, usually the warehouse. Needed before optimizing.' },
        departure: { title: 'Departure time', description: 'When the driver sets off. Used to plan arrival times.' },
        optimize: {
          title: 'Optimize',
          description: 'Puts the pending stops in the fastest order, respecting time windows and priority.',
        },
        addStop: {
          title: 'Add stops',
          description: 'Add a delivery order or a customer visit. Give it a time window or priority if it matters.',
        },
        stops: {
          title: 'Stops',
          description: 'In driving order, with live status. Failed stops show the reason and can be rescheduled to another day.',
        },
        history: { title: 'History', description: 'What changed on this route and when: start point, optimizing, reschedules.' },
      },
    },
    deliveryMonitoring: {
      title: 'Delivery Monitoring',
      steps: {
        date: { title: 'Live view', description: 'Pick a day. Today updates by itself; refresh any time.' },
        stats: {
          title: 'At a glance',
          description: 'Total, delivered, pending and failed stops — plus “at risk”: likely to miss their time window.',
        },
        map: { title: 'Map', description: 'Where every stop is and how it went.' },
        teams: { title: 'By team', description: 'Each driver’s progress. Spot who is behind and act early.' },
      },
    },
    deliveryDrivers: {
      title: 'Drivers & access control',
      steps: {
        intro: {
          title: 'Who can drive, and when',
          description: 'Drivers sign in on their phone. Here you control which phones and which hours.',
        },
        card: { title: 'A driver', description: 'Their name, photo and whether the account is active.' },
        manage: {
          title: 'Manage',
          description:
            'Approve or reject the phones they sign in from, and set access hours. No hours set means they can sign in any time.',
        },
        lock: { title: 'Lock', description: 'Instantly block a driver from signing in. Unlock to restore access.' },
      },
    },
  },
  id: {
    // ── OPS / Warehouse ─────────────────────────────────────────────────
    opsSession: {
      title: 'Sesi',
      steps: {
        intro: { title: 'Satu pekerjaan gudang', description: 'Pindai barang ke sesi ini; stok bergerak saat dipindai. Selesaikan setelah semuanya beres.' },
        stages: {
          title: 'Tahap',
          description: 'Pemenuhan: Ambil → (Kemas) → Kirim; pemindahan: Ambil → Pindah. Tahap yang disorot adalah yang sedang dipindai.',
        },
        receiveCheck: {
          title: 'Cek penerimaan',
          description: 'Jumlah yang diharapkan (dari impor) dibanding yang dihitung, per barang. Selisih ditandai untuk ditindaklanjuti ke pemasok.',
        },
        scan: { title: 'Pindai', description: 'Membuka pemindai — kamera ponsel atau pemindai barcode USB.' },
        next: { title: 'Tahap berikutnya', description: 'Lanjut setelah tahap ini selesai. Bisa kembali jika terlanjur maju.' },
        complete: {
          title: 'Selesaikan',
          description: 'Menutup sesi. Pemindahan hanya bisa selesai setelah semua yang diambil sudah disimpan.',
        },
        cancel: { title: 'Batalkan', description: 'Hanya untuk sesi yang belum memindahkan stok. Alasannya masuk ke catatan.' },
        notes: { title: 'Catatan', description: 'Tinggalkan catatan untuk tim, mis. kardus rusak atau kiriman kurang.' },
      },
    },
    opsLabels: {
      title: 'Label',
      steps: {
        intro: { title: 'Cetak label barcode', description: 'Setiap barang perlu label sebelum bisa dipindai. Jika dibuka dari kiriman, satu label per unit yang diterima.' },
        format: { title: 'Barcode atau QR', description: 'Pilih jenis kode yang dibaca pemindai Anda.' },
        settings: { title: 'Pengaturan printer', description: 'Ukuran label, resolusi printer, dan offset. Cetak tes penyelarasan pertama kali.' },
        qty: { title: 'Berapa banyak', description: 'Atur jumlah label per barang.' },
        itemPrint: { title: 'Cetak satu barang', description: 'Cetak label barang ini saja.' },
        printAll: { title: 'Cetak semua', description: 'Cetak semua barang di daftar (atau semua hasil pencarian).' },
      },
    },
    // ── Workshop ────────────────────────────────────────────────────────
    rmsVehicles: {
      title: 'Kendaraan',
      steps: {
        intro: { title: 'Semua kendaraan', description: 'Tambahkan kendaraan dari halaman pelanggan pemiliknya; kendaraan muncul di sini.' },
        search: { title: 'Cari', description: 'Berdasarkan pelat, model, VIN, atau pelanggan.' },
        row: { title: 'Buka kendaraan', description: 'Lihat seluruh riwayat servis dan buat faktur baru.' },
      },
    },
    rmsVehicle: {
      title: 'Kendaraan',
      steps: {
        intro: { title: 'Riwayat kendaraan', description: 'Setiap kunjungan dan pekerjaannya, terbaru di atas.' },
        newInvoice: { title: 'Faktur baru', description: 'Tagih servis untuk kendaraan ini. Suku cadang, jasa, dan odometer tersimpan di riwayatnya.' },
        stats: { title: 'Sekilas', description: 'Total kunjungan, servis terakhir, dan angka odometer terbaru.' },
        filters: { title: 'Cari pekerjaan lama', description: 'Cari suku cadang atau jasa, atau tampilkan draf/faktur terbit saja.' },
        visit: { title: 'Kunjungan', description: 'Buka untuk melihat fakturnya. Draf yang belum selesai bisa dilanjutkan.' },
      },
    },
    rmsReminders: {
      title: 'Pengingat',
      steps: {
        intro: { title: 'Ajak pelanggan kembali', description: 'Dikelompokkan: terlambat, segera, dan mendatang. Buat dari kendaraan atau faktur.' },
        card: { title: 'Sebuah pengingat', description: 'Kendaraan mana, apa yang jatuh tempo, dan kapan. Ketuk untuk membuka kendaraannya.' },
        complete: { title: 'Tandai selesai', description: 'Selesai — pelanggan sudah kembali atau sudah dihubungi.' },
        snooze: { title: 'Tunda', description: 'Mundurkan ke tanggal lain jika pelanggan minta menunggu.' },
      },
    },
    // ── POS / Sales ─────────────────────────────────────────────────────
    salesInvoiceNew: {
      title: 'Faktur baru',
      steps: {
        intro: { title: 'Catat penjualan', description: 'Cari barang, periksa keranjang, lalu buat dan cetak. Pekerjaan Anda tersimpan otomatis sebagai draf.' },
        format: {
          title: 'Struk atau faktur',
          description: '58mm/80mm mencetak struk cepat untuk pembeli langsung. A5/A4 adalah faktur lengkap untuk pelanggan bernama, dengan jatuh tempo dan rekening bank.',
        },
        search: { title: 'Cari barang', description: 'Ketik atau pindai nama, SKU, atau OEM. Pilih hasilnya, atur jumlah, lalu tambahkan.' },
        location: { title: 'Lokasi stok', description: 'Jual dari satu gudang saja, atau biarkan WareSys memakai lokasi dengan stok terbanyak.' },
        customer: { title: 'Pelanggan', description: 'Pilih atau tambah cepat pelanggan. Level harganya otomatis dipakai untuk baris baru.' },
        lines: { title: 'Keranjang', description: 'Ubah jumlah, beri diskon per baris, atau hapus barang. Total diperbarui langsung.' },
        priceLevel: {
          title: 'Level harga',
          description: 'Menunjukkan asal tiap harga, mis. “Grosir — Rp100.000”. Ganti per baris bila perlu.',
        },
        submit: { title: 'Buat & cetak', description: 'Menerbitkan faktur dan membukanya untuk dicetak. Setelah ini tidak bisa dihapus — hanya diubah atau dibatalkan.' },
        history: { title: 'Faktur sebelumnya', description: 'Cari, cetak ulang, terima pembayaran, atau batalkan faktur lama.' },
      },
    },
    salesInvoiceEdit: {
      title: 'Ubah faktur terbit',
      steps: {
        intro: {
          title: 'Perbaiki faktur yang sudah terbit',
          description: 'Baris yang sudah ada tetap memakai harga saat diterbitkan. Setiap perubahan tercatat di riwayat faktur.',
        },
        reason: { title: 'Alasan (wajib)', description: 'Tulis alasan perubahan, mis. “pelanggan retur 1 pcs”. Ditampilkan di riwayat perubahan.' },
        lines: { title: 'Baris', description: 'Ubah jumlah atau diskon. Jumlah tidak bisa di bawah yang sudah dikirim.' },
        search: { title: 'Tambah barang', description: 'Baris baru memakai level harga pelanggan.' },
        submit: { title: 'Simpan perubahan', description: 'Total, stok, dan pembukuan diperbarui bersamaan.' },
      },
    },
    salesInvoiceDetail: {
      title: 'Faktur',
      steps: {
        intro: { title: 'Setelah penjualan', description: 'Terima pembayaran, cetak, kirim, dan tindak lanjuti — semua dari sini.' },
        pay: { title: 'Catat pembayaran', description: 'Tunai, transfer, atau cicilan. Status berubah menjadi Sebagian atau Lunas.' },
        print: { title: 'Cetak atau unduh', description: 'Pilih format di atas, lalu cetak atau simpan PDF.' },
        toDelivery: { title: 'Surat jalan', description: 'Buat dokumen pengiriman untuk barang yang keluar dari gudang.' },
        reminder: { title: 'Pengingat servis', description: 'Atur tindak lanjut untuk kendaraan ini, mis. ganti oli berikutnya.' },
        edit: { title: 'Ubah', description: 'Perbaiki faktur dengan alasan. Perubahan tersimpan di riwayatnya.' },
        void: {
          title: 'Batalkan',
          description: 'Batalkan faktur yang keliru. Tidak bisa dikembalikan, perlu alasan, dan hanya bisa sebelum ada pembayaran.',
        },
      },
    },
    salesQuotationNew: {
      title: 'Penawaran baru',
      steps: {
        intro: { title: 'Tawarkan harga', description: 'Penawaran bersifat opsional. Saat pelanggan setuju, ubah menjadi pesanan atau faktur tanpa mengetik ulang.' },
        customer: { title: 'Pelanggan', description: 'Untuk siapa penawaran ini. Level harganya dipakai otomatis.' },
        search: { title: 'Cari barang', description: 'Cari berdasarkan nama, SKU, atau OEM lalu tambahkan.' },
        lines: { title: 'Baris', description: 'Jumlah, diskon, dan total. Anda juga bisa menambah jasa.' },
        priceLevel: { title: 'Level harga', description: 'Asal tiap harga. Ganti per baris jika pelanggan ini mendapat harga khusus.' },
        submit: { title: 'Buat & cetak', description: 'Menyimpan penawaran dan membukanya untuk dicetak atau PDF.' },
        history: { title: 'Semua penawaran', description: 'Pantau penawaran yang terkirim, diterima, dan dikonversi.' },
      },
    },
    salesQuotationDetail: {
      title: 'Penawaran',
      steps: {
        intro: { title: 'Tindak lanjuti', description: 'Draf → Terkirim → Diterima → dikonversi. Hanya tombol yang berlaku saat ini yang ditampilkan.' },
        edit: { title: 'Ubah draf', description: 'Ubah barang selama masih draf.' },
        send: { title: 'Tandai terkirim', description: 'Memberi nomor penawaran dan menandainya terkirim. Tidak ada email — bagikan PDF-nya sendiri.' },
        accept: { title: 'Pelanggan setuju', description: 'Catat jawaban pelanggan: terima atau tolak.' },
        toOrder: { title: 'Ubah ke pesanan', description: 'Menjadi pesanan penjualan dengan harga yang sama — cocok bila barang dikirim belakangan atau bertahap.' },
        toInvoice: { title: 'Ubah ke faktur', description: 'Langsung tagih dengan harga yang ditawarkan.' },
        print: { title: 'Cetak atau PDF', description: 'Cetak atau unduh PDF untuk dikirim.' },
      },
    },
    salesOrderNew: {
      title: 'Pesanan penjualan baru',
      steps: {
        intro: { title: 'Konfirmasi kebutuhan pelanggan', description: 'Pesanan mencatat apa yang dipesan pelanggan sebelum ditagih.' },
        customer: { title: 'Pelanggan', description: 'Wajib diisi. Level harganya dipakai otomatis.' },
        search: { title: 'Cari barang', description: 'Cari berdasarkan nama, SKU, atau OEM lalu tambahkan.' },
        lines: { title: 'Baris', description: 'Jumlah, diskon, dan total.' },
        priceLevel: { title: 'Level harga', description: 'Asal tiap harga. Ganti per baris bila perlu.' },
        submit: { title: 'Simpan pesanan', description: 'Disimpan sebagai draf. Konfirmasi dari halaman pesanan.' },
      },
    },
    salesOrderDetail: {
      title: 'Pesanan penjualan',
      steps: {
        intro: { title: 'Draf → dikonfirmasi → dikirim → ditagih', description: 'Hanya tombol yang berlaku saat ini yang ditampilkan.' },
        edit: { title: 'Ubah draf', description: 'Ubah barang selama masih draf.' },
        confirm: { title: 'Konfirmasi', description: 'Mengunci pesanan agar bisa dikirim dan ditagih.' },
        deliveries: {
          title: 'Pengiriman',
          description: 'Kirim pesanan dalam satu atau beberapa surat jalan, dan catat retur. Pesanan mencatat apa yang sudah terkirim.',
        },
        toInvoice: { title: 'Tagih', description: 'Tagih pesanan dengan harga yang tersimpan.' },
        print: { title: 'Cetak atau PDF', description: 'Cetak pesanan atau unduh PDF.' },
      },
    },
    // ── Delivery ─────────────────────────────────────────────────────────
    deliveryRoutes: {
      title: 'Rute Pengiriman',
      steps: {
        intro: {
          title: 'Rencanakan harinya di sini',
          description: 'Setiap tim punya satu driver dan satu rute per hari. Pilih hari, buat rute untuk tiap tim, lalu tambahkan pemberhentian.',
        },
        filters: { title: 'Pilih hari', description: 'Rute dibuat per hari. Saring berdasarkan tim atau status.' },
        teams: {
          title: 'Tim',
          description: 'Buat tim dan pilih driver untuk tiap tim. Rute milik tim; driver-nya yang menjalankan.',
        },
        invite: { title: 'Undang driver', description: 'Buat akun driver dengan kata sandi sementara. Driver masuk lewat ponsel.' },
        newRoute: { title: 'Rute baru', description: 'Buat rute untuk satu tim di hari ini, lalu buka untuk menambah pemberhentian.' },
        optimizeAll: {
          title: 'Optimasi semua driver',
          description: 'Biarkan WareSys membagi pengiriman hari ini ke para driver dan mengurutkan tiap rute.',
        },
        list: { title: 'Rute hari ini', description: 'Buka rute untuk mengatur titik awal, menambah pemberhentian, dan mengoptimalkan urutan.' },
        drivers: { title: 'Driver & akses', description: 'Kunci akun, setujui ponsel driver, dan atur jam kerja.' },
      },
    },
    deliveryPlan: {
      title: 'Optimasi semua driver',
      steps: {
        intro: {
          title: 'Rencanakan semua rute sekaligus',
          description: 'Pilih hari, tim, dan pengiriman. WareSys mengusulkan rute — belum ada yang tersimpan sampai Anda konfirmasi.',
        },
        settings: {
          title: 'Hari, jam, dan depot',
          description: 'Pilih tanggal, jam berangkat (opsional), dan depot tempat driver berangkat. Rute berakhir di pelanggan terakhir.',
        },
        teams: { title: 'Driver mana', description: 'Centang tim yang direncanakan. Rute yang sudah berjalan dikunci dan tidak diubah.' },
        deliveries: { title: 'Pengiriman mana', description: 'Centang surat jalan yang dijadwalkan hari ini.' },
        preview: {
          title: 'Pratinjau, lalu simpan',
          description: 'Lihat usulan rute di peta dulu. Yang tidak muat akan ditampilkan. Simpan jika sudah sesuai.',
        },
      },
    },
    deliveryRoute: {
      title: 'Detail rute',
      steps: {
        intro: { title: 'Satu hari kerja driver', description: 'Titik awal, lalu pemberhentian sesuai urutan perjalanan.' },
        map: { title: 'Peta', description: 'Semua pemberhentian dan titik awal. Diperbarui saat pemberhentian berubah.' },
        start: { title: 'Titik awal', description: 'Tempat driver berangkat, biasanya gudang. Wajib sebelum optimasi.' },
        departure: { title: 'Jam berangkat', description: 'Kapan driver berangkat. Dipakai untuk memperkirakan jam tiba.' },
        optimize: {
          title: 'Optimasi',
          description: 'Mengurutkan pemberhentian yang tertunda menjadi rute tercepat, mengikuti jendela waktu dan prioritas.',
        },
        addStop: {
          title: 'Tambah pemberhentian',
          description: 'Tambahkan surat jalan atau kunjungan pelanggan. Beri jendela waktu atau prioritas bila perlu.',
        },
        stops: {
          title: 'Pemberhentian',
          description: 'Sesuai urutan perjalanan, dengan status langsung. Yang gagal menampilkan alasannya dan bisa dijadwalkan ulang.',
        },
        history: { title: 'Riwayat', description: 'Apa yang berubah di rute ini dan kapan: titik awal, optimasi, penjadwalan ulang.' },
      },
    },
    deliveryMonitoring: {
      title: 'Pemantauan Pengiriman',
      steps: {
        date: { title: 'Tampilan langsung', description: 'Pilih hari. Hari ini diperbarui otomatis; muat ulang kapan saja.' },
        stats: {
          title: 'Sekilas',
          description: 'Total, terkirim, tertunda, dan gagal — plus “berisiko”: kemungkinan terlambat dari jendela waktunya.',
        },
        map: { title: 'Peta', description: 'Lokasi setiap pemberhentian dan hasilnya.' },
        teams: { title: 'Per tim', description: 'Progres tiap driver. Lihat siapa yang tertinggal dan bertindak lebih awal.' },
      },
    },
    deliveryDrivers: {
      title: 'Driver & kontrol akses',
      steps: {
        intro: {
          title: 'Siapa boleh mengantar, dan kapan',
          description: 'Driver masuk lewat ponsel. Di sini Anda mengatur ponsel mana dan jam berapa.',
        },
        card: { title: 'Seorang driver', description: 'Nama, foto, dan status akun aktif atau tidak.' },
        manage: {
          title: 'Kelola',
          description: 'Setujui atau tolak ponsel yang dipakai, dan atur jam akses. Tanpa jam berarti bisa masuk kapan saja.',
        },
        lock: { title: 'Kunci', description: 'Langsung blokir driver agar tidak bisa masuk. Buka kunci untuk memulihkan akses.' },
      },
    },
  },
};
