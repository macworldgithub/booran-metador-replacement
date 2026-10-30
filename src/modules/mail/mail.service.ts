import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    if (!user || !pass) {
      this.logger.warn('SMTP credentials not configured. Outgoing emails will only be logged.');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass,
        },
      });
      this.logger.log(`Mail transporter initialized using ${host}:${port} (${user})`);
    } catch (err) {
      this.logger.error('Failed to initialize mail transporter', err);
    }
  }

  async sendPasswordResetEmail(
    toEmail: string,
    resetUrl: string,
    userName?: string,
  ): Promise<boolean> {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@booran.com.au';
    const greeting = userName ? `Hello ${userName},` : 'Hello,';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your Booran Motor Group password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0b1324; padding: 28px 32px; text-align: left;">
              <div style="color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">BOORAN MOTOR GROUP</div>
              <div style="color: #94a3b8; font-size: 11px; letter-spacing: 1px; margin-top: 4px; text-transform: uppercase;">New-Lead SMS Portal</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 32px 32px;">
              <h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0;">Reset your password</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 20px 0;">
                ${greeting}
              </p>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 24px 0;">
                We received a request to reset the password for your Booran Motor Group account (<strong>${toEmail}</strong>). Click the button below to choose a new password:
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td align="left">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #0284c7; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.25);">
                      Reset Password &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 24px 0 0 0;">
                This link will expire in <strong>60 minutes</strong> and can only be used once.
              </p>

              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />

              <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 0 0 8px 0;">
                If the button above does not work, copy and paste this URL into your browser:
              </p>
              <p style="font-size: 12px; line-height: 1.5; color: #0284c7; word-break: break-all; margin: 0 0 20px 0;">
                <a href="${resetUrl}" style="color: #0284c7; text-decoration: underline;">${resetUrl}</a>
              </p>

              <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
                If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: left;">
              <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                Booran Motor Group &bull; Connecting Cranbourne Kia, Cranbourne MG & Geely Cranbourne
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    if (!this.transporter) {
      this.initTransporter();
    }

    if (!this.transporter) {
      this.logger.warn(`No transporter available. Reset link for ${toEmail}: ${resetUrl}`);
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: `Booran Motor Group <${from}>`,
        to: toEmail,
        subject: 'Reset your Booran Motor Group password',
        text: `Reset your Booran Motor Group password:\n\n${resetUrl}\n\nThis link will expire in 60 minutes.\nIf you did not request this, please ignore this email.`,
        html,
      });

      this.logger.log(`Password reset email sent to ${toEmail}. MessageId: ${info.messageId}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send password reset email to ${toEmail}: ${err.message}`, err.stack);
      return false;
    }
  }
}
