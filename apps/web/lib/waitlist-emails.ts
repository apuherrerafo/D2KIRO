import type { WaitlistEmail } from "./waitlist-mailer";

// Texto de los tres correos de la waitlist (en inglés, como la portada). Solo texto plano: nada que escapar.
// Regla de producto: D2KIRO LIVE se anuncia como beneficio PRÓXIMO; ningún correo promete acceso ni fecha.

export function verificationEmail(link: string): WaitlistEmail {
  return {
    subject: "Confirm your email for the D2KIRO waitlist",
    text: [
      "Someone asked to join the D2KIRO waitlist with this email address.",
      "",
      "Confirm it here (the link works once and expires in 24 hours):",
      link,
      "",
      "If it was not you, ignore this email: nobody joins the waitlist without confirming.",
    ].join("\n"),
  };
}

const LIVE_AHEAD = "Coming later for people on the waitlist: D2KIRO LIVE. It is not available yet, and we have no date to announce.";
const NO_ACCESS_YET = "Being on the waitlist does not open the draft coach. The beta is private and by invitation; admission is a separate step.";

export function welcomeEmail(): WaitlistEmail {
  return {
    subject: "You are on the D2KIRO waitlist",
    text: ["Your email is confirmed: you are on the D2KIRO waitlist.", "", LIVE_AHEAD, "", NO_ACCESS_YET].join("\n"),
  };
}

export function alreadyListedEmail(): WaitlistEmail {
  return {
    subject: "You are already on the D2KIRO waitlist",
    text: [
      "You asked to join again: this email is already confirmed on the D2KIRO waitlist. There is nothing else to do.",
      "",
      LIVE_AHEAD,
      "",
      NO_ACCESS_YET,
    ].join("\n"),
  };
}
