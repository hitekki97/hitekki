import { connect } from "cloudflare:sockets";

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
  if (!env.MAIL_PASSWORD) {
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
  const text = [`Name: ${name}`, `Firma: ${company}`, `E-Mail: ${email}`, `Telefon: ${phone}`, "", message].join("\n");
  try {
    await sendMail({
      password: env.MAIL_PASSWORD,
      replyTo: email,
      subject: `Anfrage von ${company}`,
      text,
    });
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

function b64(value) {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

async function sendMail({ password, replyTo, subject, text }) {
  const socket = connect({ hostname: "mail.infomaniak.com", port: 465 }, { secureTransport: "on" });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  async function readLine() {
    while (!buffer.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("closed");
      buffer += decoder.decode(value, { stream: true });
    }
    const index = buffer.indexOf("\n");
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    return line;
  }

  async function readReply() {
    let line = await readLine();
    const code = line.slice(0, 3);
    while (line.length > 3 && line[3] === "-") line = await readLine();
    return { code, line };
  }

  async function command(line, ok) {
    await writer.write(encoder.encode(`${line}\r\n`));
    const reply = await readReply();
    if (!ok.includes(reply.code)) throw new Error(reply.line);
    return reply;
  }

  const greeting = await readReply();
  if (greeting.code !== "220") throw new Error(greeting.line);
  await command("EHLO hitekki.ch", ["250"]);
  await command("AUTH LOGIN", ["334"]);
  await command(b64("kontakt@hitekki.ch"), ["334"]);
  await command(b64(password), ["235"]);
  await command("MAIL FROM:<kontakt@hitekki.ch>", ["250"]);
  await command("RCPT TO:<kontakt@hitekki.ch>", ["250", "251"]);
  await command("DATA", ["354"]);
  const safeText = text.replace(/\n\./g, "\n..");
  const payload = [
    "From: HiTekKi <kontakt@hitekki.ch>",
    "To: kontakt@hitekki.ch",
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    safeText,
    ".",
  ].join("\r\n");
  await writer.write(encoder.encode(`${payload}\r\n`));
  const accepted = await readReply();
  if (accepted.code !== "250") throw new Error(accepted.line);
  try {
    await command("QUIT", ["221"]);
    await writer.close();
  } catch {
    /* the message is already accepted */
  }
}

function encodeSubject(subject) {
  if (/^[\u0020-\u007E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${b64(subject)}?=`;
}
