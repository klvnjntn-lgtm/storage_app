// Email wording for documents and reminders. Indonesian by default
// (MESSAGE_LANGUAGE=en for English) since that's who receives them. Every
// value is HTML-escaped: customer and business names are user input.

export type MessageLanguage = 'id' | 'en';

export function money(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

export function shortDate(d: Date, lang: MessageLanguage): string {
  return d.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Rendered = { subject: string; html: string; text: string };

function wrap(
  paragraphs: string[],
  business: string,
): Pick<Rendered, 'html' | 'text'> {
  return {
    html:
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.5">` +
      paragraphs.map((p) => `<p>${p}</p>`).join('') +
      `<p style="color:#666">— ${esc(business)}</p></div>`,
    text:
      paragraphs.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n') +
      `\n\n— ${business}`,
  };
}

const note = (n: string | undefined) => (n ? [esc(n)] : []);

type Vars = Record<string, unknown> & { business: string; note?: string };

export function messageText(
  lang: MessageLanguage,
  kind: 'invoice' | 'purchaseOrder' | 'statement' | 'reminder' | 'workOrderReady',
  v: Vars,
): Rendered {
  const id = lang === 'id';
  switch (kind) {
    case 'invoice':
      return {
        subject: id
          ? `Faktur ${v.number} dari ${v.business}`
          : `Invoice ${v.number} from ${v.business}`,
        ...wrap(
          [
            id
              ? `Yth. ${esc(v.customer) || 'Pelanggan'},`
              : `Dear ${esc(v.customer) || 'customer'},`,
            id
              ? `Terlampir faktur <b>${esc(v.number)}</b> sebesar <b>${esc(v.total)}</b>, jatuh tempo ${esc(v.due)}.`
              : `Please find attached invoice <b>${esc(v.number)}</b> for <b>${esc(v.total)}</b>, due ${esc(v.due)}.`,
            ...note(v.note),
            id
              ? 'Terima kasih atas kepercayaan Anda.'
              : 'Thank you for your business.',
          ],
          v.business,
        ),
      };
    case 'purchaseOrder':
      return {
        subject: id
          ? `Pesanan pembelian ${v.number} dari ${v.business}`
          : `Purchase order ${v.number} from ${v.business}`,
        ...wrap(
          [
            id
              ? `Yth. ${esc(v.supplier) || 'Bapak/Ibu'},`
              : `Dear ${esc(v.supplier) || 'supplier'},`,
            id
              ? `Terlampir pesanan pembelian <b>${esc(v.number)}</b> senilai <b>${esc(v.total)}</b>. Mohon konfirmasi ketersediaan dan perkiraan pengiriman.`
              : `Please find attached purchase order <b>${esc(v.number)}</b> for <b>${esc(v.total)}</b>. Kindly confirm availability and expected delivery.`,
            ...note(v.note),
          ],
          v.business,
        ),
      };
    case 'statement': {
      const lines =
        (v.lines as { number: string; date: string; balance: string }[]) ?? [];
      const table = lines.length
        ? `<table style="border-collapse:collapse">${lines
            .map(
              (l) =>
                `<tr><td style="padding:2px 12px 2px 0">${esc(l.number)}</td><td style="padding:2px 12px 2px 0">${esc(l.date)}</td><td style="text-align:right">${esc(l.balance)}</td></tr>`,
            )
            .join('')}</table>`
        : id
          ? 'Tidak ada faktur yang belum dibayar.'
          : 'No unpaid invoices.';
      return {
        subject: id
          ? `Laporan tagihan ${v.period} — ${v.business}`
          : `Statement ${v.period} — ${v.business}`,
        ...wrap(
          [
            id ? `Yth. ${esc(v.customer)},` : `Dear ${esc(v.customer)},`,
            id
              ? `Berikut laporan tagihan Anda untuk periode ${esc(v.period)}. Saldo akhir: <b>${esc(v.balance)}</b>.`
              : `Here is your statement for ${esc(v.period)}. Closing balance: <b>${esc(v.balance)}</b>.`,
            table,
            ...note(v.note),
          ],
          v.business,
        ),
      };
    }
    case 'reminder': {
      const stage = Number(v.stage);
      const when =
        stage < 0
          ? id
            ? `akan jatuh tempo pada ${esc(v.due)}`
            : `is due on ${esc(v.due)}`
          : id
            ? `telah jatuh tempo pada ${esc(v.due)} (${stage} hari yang lalu)`
            : `was due on ${esc(v.due)} (${stage} day${stage > 1 ? 's' : ''} ago)`;
      return {
        subject: id
          ? `Pengingat pembayaran faktur ${v.number}`
          : `Payment reminder: invoice ${v.number}`,
        ...wrap(
          [
            id
              ? `Yth. ${esc(v.customer) || 'Pelanggan'},`
              : `Dear ${esc(v.customer) || 'customer'},`,
            id
              ? `Faktur <b>${esc(v.number)}</b> dengan sisa tagihan <b>${esc(v.amount)}</b> ${when}.`
              : `Invoice <b>${esc(v.number)}</b> with <b>${esc(v.amount)}</b> outstanding ${when}.`,
            ...(v.bank
              ? [
                  id
                    ? `Pembayaran dapat ditransfer ke ${esc(v.bank)}.`
                    : `Payment can be made to ${esc(v.bank)}.`,
                ]
              : []),
            id
              ? 'Abaikan pesan ini jika pembayaran sudah dilakukan.'
              : 'Please ignore this message if you have already paid.',
          ],
          v.business,
        ),
      };
    }
    case 'workOrderReady':
      return {
        subject: id
          ? `Kendaraan ${v.plate} sudah selesai — ${v.business}`
          : `Your car ${v.plate} is ready — ${v.business}`,
        ...wrap(
          [
            id
              ? `Yth. ${esc(v.customer) || 'Pelanggan'},`
              : `Dear ${esc(v.customer) || 'customer'},`,
            id
              ? `Pekerjaan untuk kendaraan <b>${esc(v.plate)}</b> (${esc(v.number)}) sudah selesai dan siap diambil.`
              : `The work on <b>${esc(v.plate)}</b> (${esc(v.number)}) is done and the car is ready for pickup.`,
            ...note(v.note),
          ],
          v.business,
        ),
      };
  }
}
