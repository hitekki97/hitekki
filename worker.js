export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/anfrage") {
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request, env) {
  if (!env.WEB3FORMS_KEY) {
    return json({ ok: false, error: "not-configured" }, 503);
  }
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
  const text = [`Firma: ${company}`, `Telefon: ${phone}`, "", message].join("\n");
  try {
    const response = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_KEY,
        subject: `Anfrage von ${company}`,
        name,
        email,
        message: text,
        from_name: "HiTekKi Website",
      }),
    });
    const result = await response.json();
    if (!response.ok || result.success === false || result.success === "false") {
      return json({ ok: false, error: "send" }, 502);
    }
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
