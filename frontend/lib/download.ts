// Saves a file response (Content-Disposition: attachment) to the user's
// computer. In the desktop app this opens the usual Save dialog.
export async function downloadResponse(res: Response, fallbackName: string) {
  const name = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
