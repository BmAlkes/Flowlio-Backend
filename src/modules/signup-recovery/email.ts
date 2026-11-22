import type { PendingSignup, SignupReason } from "./service";

export type FollowupLanguage = "pt" | "en";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

export const REASON_LABELS: Record<FollowupLanguage, Record<SignupReason, string>> = {
  pt: {
    price: "O preço",
    missing_feature: "Faltou alguma funcionalidade",
    too_complex: "Achei complicado",
    payment_problem: "Tive problema no pagamento",
    just_exploring: "Só estava conhecendo",
    other: "Outro motivo",
  },
  en: {
    price: "The price",
    missing_feature: "A feature I need is missing",
    too_complex: "It felt complicated",
    payment_problem: "I had a payment problem",
    just_exploring: "I was just looking around",
    other: "Something else",
  },
};

const COPY = {
  pt: {
    subject: "Faltou pouco para começar no Flowlio",
    hello: (name: string) => `Olá, ${name}!`,
    noPlan: (date: string) => `Você criou sua conta no Flowlio em ${date}, mas não chegou a escolher um plano.`,
    checkout: (date: string, plan: string | null) =>
      `Você começou seu cadastro no Flowlio em ${date}${plan ? ` e escolheu o plano ${plan}` : ""}, mas ele parou antes do pagamento.`,
    ask: "Pode nos contar o que aconteceu? Um clique já nos ajuda a melhorar:",
    reply: "Se preferir, é só responder este email. Lemos todas as respostas.",
    cta: "Continuar meu cadastro",
    footer: "Você recebeu este email porque criou uma conta no Flowlio e o cadastro ficou incompleto.",
    unsubscribe: "Não quero receber mais emails sobre isso",
  },
  en: {
    subject: "You're one step away from starting with Flowlio",
    hello: (name: string) => `Hi ${name},`,
    noPlan: (date: string) => `You created your Flowlio account on ${date} but didn't pick a plan.`,
    checkout: (date: string, plan: string | null) =>
      `You started signing up for Flowlio on ${date}${plan ? ` and chose the ${plan} plan` : ""}, but stopped before payment.`,
    ask: "Could you tell us what happened? One click helps us improve:",
    reply: "Or just reply to this email. We read every answer.",
    cta: "Continue my signup",
    footer: "You received this email because you created a Flowlio account and the signup wasn't finished.",
    unsubscribe: "Don't email me about this again",
  },
};

function formatDate(value: string, language: FollowupLanguage) {
  return new Intl.DateTimeFormat(language === "pt" ? "pt-BR" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function followupEmail(signup: PendingSignup, language: FollowupLanguage, links: { answer: (reason: string) => string; continueUrl: string }) {
  const copy = COPY[language];
  const firstName = (signup.name || "").trim().split(/\s+/)[0] || signup.email.split("@")[0];
  const date = formatDate(signup.createdAt, language);
  const situation = signup.stage === "no_plan" ? copy.noPlan(date) : copy.checkout(date, signup.planName);
  const labels = REASON_LABELS[language];
  const buttons = (Object.keys(labels) as SignupReason[])
    .map(reason => `<a href="${escape(links.answer(reason))}" style="display:block;margin:0 0 8px;padding:10px 14px;border:1px solid #d0d7e2;border-radius:8px;color:#1a202c;text-decoration:none;">${escape(labels[reason])}</a>`)
    .join("");
  const html = `
  <div style="font-family:Arial,sans-serif;background:#f7f9fb;padding:32px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;color:#1a202c;font-size:15px;line-height:1.5;">
      <p style="margin:0 0 12px;">${escape(copy.hello(firstName))}</p>
      <p style="margin:0 0 12px;">${escape(situation)}</p>
      <p style="margin:0 0 16px;">${escape(copy.ask)}</p>
      ${buttons}
      <p style="margin:16px 0;">${escape(copy.reply)}</p>
      <p style="margin:24px 0;text-align:center;"><a href="${escape(links.continueUrl)}" style="background:#1797b9;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">${escape(copy.cta)}</a></p>
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">${escape(copy.footer)} <a href="${escape(links.answer("unsubscribe"))}" style="color:#6b7280;">${escape(copy.unsubscribe)}</a></p>
    </div>
  </div>`;
  const text = [copy.hello(firstName), "", situation, "", copy.ask, ...(Object.keys(labels) as SignupReason[]).map(reason => `- ${labels[reason]}: ${links.answer(reason)}`), "", copy.reply, "", `${copy.cta}: ${links.continueUrl}`, "", `${copy.footer} ${copy.unsubscribe}: ${links.answer("unsubscribe")}`].join("\n");
  return { subject: copy.subject, html, text };
}

const PAGE = {
  pt: { confirm: "Confirmar resposta", question: "Sua resposta:", thanks: "Obrigado! Recebemos sua resposta.", unsubscribed: "Pronto, você não receberá mais emails sobre o cadastro.", invalid: "Este link não é válido.", unsubscribeLabel: "Não receber mais emails sobre isso", continue: "Continuar meu cadastro" },
  en: { confirm: "Confirm answer", question: "Your answer:", thanks: "Thank you! We got your answer.", unsubscribed: "Done, you won't get more emails about your signup.", invalid: "This link is not valid.", unsubscribeLabel: "Don't email me about this again", continue: "Continue my signup" },
};

/** Small standalone page for the answer links. GET only shows a confirm button so link scanners can't answer. */
export function answerPage(language: FollowupLanguage, state: { kind: "confirm"; answer: string } | { kind: "done"; answer: string } | { kind: "invalid" }, continueUrl: string) {
  const copy = PAGE[language];
  const label = (answer: string) => (answer === "unsubscribe" ? copy.unsubscribeLabel : REASON_LABELS[language][answer as SignupReason] ?? answer);
  let body: string;
  if (state.kind === "invalid") body = `<p>${copy.invalid}</p>`;
  else if (state.kind === "confirm")
    body = `<p>${copy.question} <strong>${escape(label(state.answer))}</strong></p><form method="post"><button type="submit" style="background:#1797b9;color:#fff;border:0;padding:12px 22px;border-radius:8px;font-size:15px;cursor:pointer;">${copy.confirm}</button></form>`;
  else
    body = `<p>${state.answer === "unsubscribe" ? copy.unsubscribed : copy.thanks}</p>${state.answer === "unsubscribe" ? "" : `<p><a href="${escape(continueUrl)}" style="color:#1797b9;">${copy.continue}</a></p>`}`;
  return `<!doctype html><html lang="${language === "pt" ? "pt-BR" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Flowlio</title></head>
<body style="margin:0;font-family:Arial,sans-serif;background:#f7f9fb;color:#1a202c;"><div style="max-width:440px;margin:48px auto;background:#fff;border-radius:12px;padding:28px 24px;font-size:15px;line-height:1.5;"><h1 style="font-size:20px;margin:0 0 16px;">Flowlio</h1>${body}</div></body></html>`;
}
