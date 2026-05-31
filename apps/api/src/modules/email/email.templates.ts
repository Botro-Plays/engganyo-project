const BASE_STYLES = `
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0 !important; padding: 0 !important; }
`;

function baseLayout(content: string, previewText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Engganyo</title>
  <style>${BASE_STYLES}</style>
</head>
<body style="margin:0;padding:0;background-color:#0d1117;font-family:Arial,Helvetica,sans-serif;">

  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div>

  <!-- Email wrapper -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#0d1117;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#3b62f5,#d946ef);border-radius:14px;padding:2px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#0d1117;border-radius:12px;padding:12px 24px;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="vertical-align:middle;padding-right:10px;">
                                <div style="width:28px;height:28px;background:linear-gradient(135deg,#3b62f5,#d946ef);border-radius:8px;text-align:center;line-height:28px;font-size:15px;">&#9889;</div>
                              </td>
                              <td style="vertical-align:middle;">
                                <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">engganyo</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card body -->
          <tr>
            <td style="background:#161b2e;border-radius:16px;border:1px solid #1e2a45;overflow:hidden;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px;font-size:12px;color:#4b5670;line-height:1.5;">
                You received this email because you have an account at
                <a href="https://engganyo.com" style="color:#3b62f5;text-decoration:none;">engganyo.com</a>
              </p>
              <p style="margin:0;font-size:12px;color:#4b5670;">
                &copy; ${new Date().getFullYear()} Engganyo. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export function verificationEmailTemplate(verifyUrl: string): string {
  const content = `
    <!-- Top accent bar -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:linear-gradient(90deg,#3b62f5,#d946ef);height:4px;"></td>
      </tr>
    </table>

    <!-- Body content -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:40px 40px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#3b62f5,#2444e8);border-radius:14px;padding:14px;">
                <div style="font-size:22px;line-height:1;">&#9993;</div>
              </td>
            </tr>
          </table>
          <h1 style="margin:20px 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
            Verify your email address
          </h1>
          <p style="margin:0;font-size:15px;color:#8892a4;line-height:1.6;">
            Welcome to Engganyo! You&rsquo;re one step away from growing your audience.
            Click the button below to verify your email and activate your account.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px;">
          <!-- CTA Button -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="border-radius:10px;background:linear-gradient(135deg,#3b62f5,#2444e8);">
                <a href="${verifyUrl}"
                   target="_blank"
                   style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                  Verify Email Address
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 24px;">
          <!-- Divider -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="border-top:1px solid #1e2a45;padding-top:24px;">
                <p style="margin:0 0 8px;font-size:12px;color:#4b5670;">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-size:12px;word-break:break-all;">
                  <a href="${verifyUrl}" style="color:#3b62f5;text-decoration:none;">${verifyUrl}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 32px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0d1117;border-radius:10px;border:1px solid #1e2a45;">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0;font-size:12px;color:#4b5670;line-height:1.6;">
                  &#9888;&#65039; This link expires in <strong style="color:#8892a4;">24 hours</strong>.
                  If you didn't create an Engganyo account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return baseLayout(content, 'Verify your email to activate your Engganyo account.');
}

export function passwordResetEmailTemplate(resetUrl: string): string {
  const content = `
    <!-- Top accent bar -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:linear-gradient(90deg,#f59e0b,#ef4444);height:4px;"></td>
      </tr>
    </table>

    <!-- Body content -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:40px 40px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:14px;padding:14px;">
                <div style="font-size:22px;line-height:1;">&#128274;</div>
              </td>
            </tr>
          </table>
          <h1 style="margin:20px 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
            Reset your password
          </h1>
          <p style="margin:0;font-size:15px;color:#8892a4;line-height:1.6;">
            We received a request to reset the password for your Engganyo account.
            Click the button below to choose a new password.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px;">
          <!-- CTA Button -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="border-radius:10px;background:linear-gradient(135deg,#f59e0b,#d97706);">
                <a href="${resetUrl}"
                   target="_blank"
                   style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                  Reset Password
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="border-top:1px solid #1e2a45;padding-top:24px;">
                <p style="margin:0 0 8px;font-size:12px;color:#4b5670;">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-size:12px;word-break:break-all;">
                  <a href="${resetUrl}" style="color:#3b62f5;text-decoration:none;">${resetUrl}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 32px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0d1117;border-radius:10px;border:1px solid #1e2a45;">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0;font-size:12px;color:#4b5670;line-height:1.6;">
                  &#9888;&#65039; This link expires in <strong style="color:#8892a4;">1 hour</strong>.
                  If you didn't request a password reset, you can safely ignore this email —
                  your password will not be changed.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return baseLayout(content, 'Reset your Engganyo password. Link expires in 1 hour.');
}
