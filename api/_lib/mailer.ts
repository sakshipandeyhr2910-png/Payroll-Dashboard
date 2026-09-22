import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

let transporter: Transporter | null = null;
let transporterKey: string | null = null;

function getTransporter(smtp: SmtpCredentials): Transporter {
  // Keyed by host+user so a credential change (e.g. env var updated without a redeploy — not
  // normally possible on Vercel, but cheap to guard against) doesn't keep using a stale client.
  const key = `${smtp.host}:${smtp.port}:${smtp.user}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      requireTLS: smtp.port !== 465,
      auth: { user: smtp.user, pass: smtp.password },
    });
    transporterKey = key;
  }
  return transporter;
}

// Throws on failure rather than silently falling back to logging the code somewhere — an OTP
// that only "worked" by ending up in a server log isn't meaningfully different from having no OTP
// check at all. The caller (api/_lib/routes/employeeAuthRequestOtp.ts) reports a real error back
// to the employee if this throws, rather than claiming the email was sent.
export async function sendOtpEmail(smtp: SmtpCredentials, to: string, name: string, code: string): Promise<void> {
  await getTransporter(smtp).sendMail({
    from: smtp.from || smtp.user,
    to,
    subject: 'Your Koenig Payroll Dashboard verification code',
    text: `Hi ${name},\n\nYour one-time verification code is ${code}. It expires in 5 minutes.\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<p>Hi ${name},</p><p>Your one-time verification code is <b style="font-size:22px;letter-spacing:3px;">${code}</b>. It expires in 5 minutes.</p><p>If you did not request this, you can safely ignore this email.</p>`,
  });
}
