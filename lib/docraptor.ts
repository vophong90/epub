// lib/docraptor.ts
export async function renderPdfWithDocRaptor(params: {
  html: string;
  name?: string;            // file name in DocRaptor history
  test?: boolean;           // true = trial (thường có watermark), false = production
}) {
  const apiKey = process.env.DOCRAPTOR_API_KEY;
  if (!apiKey) throw new Error("Missing env DOCRAPTOR_API_KEY");

  const { html, name = "book.pdf", test = true } = params;

  const auth = Buffer.from(`${apiKey}:`).toString("base64");

  const res = await fetch("https://api.docraptor.com/docs", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_type: "pdf",
      name,
      document_content: html,

      // trial/test: true để thử, false để production
      test,

      // Prince options (DocRaptor uses Prince underneath)
      prince_options: {
        media: "print",
        // baseurl giúp resolve url() và link tương đối (nếu cần)
        // baseurl: "https://your-site.com/",
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DocRaptor error (${res.status}): ${txt}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
