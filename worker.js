export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/anfrage") {
      return handleContact(request);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }
  const name = clean(data.name, 120);
  const company = clean(data.company, 160);
  const email = clean(data.email, 160);
  const phone = clean(data.phone, 40);
  const message = clean(data.message, 4000);
  if (clean(data.hp_email || "", 200) || clean(data._honey || "", 200)) {
    return json({ ok: true });
  }
  if (name.length < 2 || company.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 6 || message.length < 10) {
    return json({ ok: false, error: "invalid" }, 400);
  }
  try {
    const response = await fetch("https://formsubmit.co/ajax/kontakt@hitekki.ch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://hitekki.ch",
        Referer: "https://hitekki.ch/",
      },
      body: JSON.stringify({
        name,
        company,
        email,
        phone,
        message,
        _subject: `Anfrage von ${company}`,
        _template: "table",
        _captcha: "false",
        _replyto: email,
      }),
    });
    const result = await response.json();
    const success = result.success === true || result.success === "true";
    if (!success) return json({ ok: false, error: "send", message: result.message || "" }, 502);
  } catch {
    return json({ ok: false, error: "send" }, 502);
  }
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clean(value, max) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
}