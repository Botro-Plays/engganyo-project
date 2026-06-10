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
              <a href="https://engganyo.com" target="_blank" style="display:inline-block;text-decoration:none;">
                <img src="https://engganyo.com/logo-horizontal.svg"
                     alt="Engganyo"
                     width="160"
                     height="40"
                     style="display:block;border:0;height:auto;max-width:160px;" />
              </a>
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

export function weeklyDigestEmailTemplate(data: {
  username: string;
  tasksCompleted: number;
  creditsEarned: number;
  currentBalance: number;
  newCampaigns: number;
  weekStart: string;
  weekEnd: string;
  xpEarned?: number;
  tasksInProgress?: number;
  tasksPending?: number;
  totalTasksCompleted?: number;
  weeklyRank?: number;
  allTimeRank?: number;
  streak?: number;
}): string {
  const { username, tasksCompleted, creditsEarned, currentBalance, newCampaigns, weekStart, weekEnd } = data;
  const xpEarned = data.xpEarned ?? 0;
  const tasksInProgress = data.tasksInProgress ?? 0;
  const tasksPending = data.tasksPending ?? 0;
  const totalTasksCompleted = data.totalTasksCompleted ?? 0;
  const weeklyRank = data.weeklyRank ?? 0;
  const allTimeRank = data.allTimeRank ?? 0;
  const streak = data.streak ?? 0;

  const extraStatsRow1 = (tasksInProgress > 0 || tasksPending > 0 || xpEarned > 0)
    ? `<tr>
      <td width="50%" style="padding-right:8px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">XP Earned</p>
            <p style="margin:0;font-size:28px;font-weight:700;color:#8b5cf6;">${xpEarned}</p>
          </td></tr>
        </table>
      </td>
      <td width="50%" style="padding-left:8px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">In Progress</p>
            <p style="margin:0;font-size:28px;font-weight:700;color:#06b6d4;">${tasksInProgress}</p>
          </td></tr>
        </table>
      </td>
    </tr>
    <tr><td colspan="2" style="height:16px;"></td></tr>`
    : '';

  const extraStatsRow2 = (totalTasksCompleted > 0 || weeklyRank > 0 || allTimeRank > 0 || streak > 0)
    ? `<tr>
      <td width="50%" style="padding-right:8px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">Total Completed</p>
            <p style="margin:0;font-size:28px;font-weight:700;color:#ec4899;">${totalTasksCompleted}</p>
          </td></tr>
        </table>
      </td>
      <td width="50%" style="padding-left:8px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">Current Streak</p>
            <p style="margin:0;font-size:28px;font-weight:700;color:#f97316;">${streak}d</p>
          </td></tr>
        </table>
      </td>
    </tr>
    <tr><td colspan="2" style="height:16px;"></td></tr>`
    : '';

  const rankSection = (weeklyRank > 0 || allTimeRank > 0)
    ? `<tr>
      <td style="padding:0 40px 24px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="margin:0 0 8px;font-size:13px;color:#8892a4;line-height:1.5;">Leaderboard Rankings</p>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="50%" style="padding-right:8px;">
                    <p style="margin:0 0 2px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">Weekly</p>
                    <p style="margin:0;font-size:20px;font-weight:700;color:#10b981;">#${weeklyRank}</p>
                  </td>
                  <td width="50%" style="padding-left:8px;">
                    <p style="margin:0 0 2px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">All-Time</p>
                    <p style="margin:0;font-size:20px;font-weight:700;color:#3b62f5;">#${allTimeRank}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    : '';

  const content = `
    <!-- Top accent bar -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:linear-gradient(90deg,#3b62f5,#10b981);height:4px;"></td>
      </tr>
    </table>

    <!-- Body content -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:40px 40px 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#3b62f5,#10b981);border-radius:14px;padding:14px;">
                <div style="font-size:22px;line-height:1;">&#128197;</div>
              </td>
            </tr>
          </table>
          <h1 style="margin:20px 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
            Your Weekly Digest
          </h1>
          <p style="margin:0;font-size:15px;color:#8892a4;line-height:1.6;">
            Hi ${username}, here&rsquo;s what happened on Engganyo this week (${weekStart} &ndash; ${weekEnd}).
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px;">
          <!-- Stats grid -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="50%" style="padding-right:8px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
                  <tr><td style="padding:20px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">Tasks Completed</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#10b981;">${tasksCompleted}</p>
                  </td></tr>
                </table>
              </td>
              <td width="50%" style="padding-left:8px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
                  <tr><td style="padding:20px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">Credits Earned</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#3b62f5;">${creditsEarned}</p>
                  </td></tr>
                </table>
              </td>
            </tr>
            <tr><td colspan="2" style="height:16px;"></td></tr>
            <tr>
              <td width="50%" style="padding-right:8px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
                  <tr><td style="padding:20px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">Current Balance</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#d946ef;">${currentBalance}</p>
                  </td></tr>
                </table>
              </td>
              <td width="50%" style="padding-left:8px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0a0f1e;border-radius:10px;border:1px solid #1e2a45;">
                  <tr><td style="padding:20px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#4b5670;text-transform:uppercase;letter-spacing:0.05em;">New Campaigns</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#f59e0b;">${newCampaigns}</p>
                  </td></tr>
                </table>
              </td>
            </tr>
            <tr><td colspan="2" style="height:16px;"></td></tr>
            ${extraStatsRow1}
            ${extraStatsRow2}
          </table>
        </td>
      </tr>
      ${rankSection}
      <tr>
        <td style="padding:0 40px 32px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#0d1117;border-radius:10px;border:1px solid #1e2a45;">
            <tr>
              <td align="center" style="padding:20px;">
                <a href="https://engganyo.com/dashboard" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background:linear-gradient(135deg,#3b62f5,#2444e8);">
                  Go to Dashboard
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return baseLayout(content, `Your Engganyo weekly digest: ${tasksCompleted} tasks, ${creditsEarned} credits earned.`);
}

export function twoFactorEmailTemplate(code: string): string {
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
                <div style="font-size:22px;line-height:1;">&#128272;</div>
              </td>
            </tr>
          </table>
          <h1 style="margin:20px 0 8px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
            Your sign-in code
          </h1>
          <p style="margin:0;font-size:15px;color:#8892a4;line-height:1.6;">
            Use the code below to complete your sign-in to Engganyo.
            This code expires in <strong style="color:#c4cad6;">10 minutes</strong>.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                 style="background:#0a0f1e;border-radius:12px;border:1px solid #1e2a45;">
            <tr>
              <td align="center" style="padding:32px 20px;">
                <p style="margin:0 0 8px;font-size:13px;color:#4b5670;letter-spacing:0.05em;text-transform:uppercase;">Verification code</p>
                <p style="margin:0;font-size:42px;font-weight:700;color:#ffffff;letter-spacing:10px;font-family:monospace;">${code}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 40px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                 style="background:#0f1826;border-radius:10px;border:1px solid #1e2a45;">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0;font-size:12px;color:#4b5670;line-height:1.6;">
                  &#128274; If you didn&rsquo;t try to sign in to Engganyo, please ignore this email —
                  your account remains secure.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return baseLayout(content, `Your Engganyo sign-in code: ${code}. Expires in 10 minutes.`);
}

export function announcementEmailTemplate(data: {
  title: string;
  bodyHtml: string;
  theme: 'blue' | 'amber' | 'rose';
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const { title, bodyHtml, theme, ctaLabel, ctaUrl } = data;

  const themeColors: Record<string, { gradient: string; solid: string; light: string }> = {
    blue:   { gradient: 'linear-gradient(135deg,#3b62f5,#2444e8)', solid: '#3b62f5', light: '#3b62f5/10' },
    amber:  { gradient: 'linear-gradient(135deg,#f59e0b,#d97706)', solid: '#f59e0b', light: '#f59e0b/10' },
    rose:   { gradient: 'linear-gradient(135deg,#f43f5e,#e11d48)', solid: '#f43f5e', light: '#f43f5e/10' },
  };

  const t = themeColors[theme] ?? themeColors.blue;
  const ctaBlock = ctaLabel && ctaUrl
    ? `<tr>
        <td align="center" style="padding:0 40px 32px;">
          <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background:${t.gradient};">
            ${ctaLabel}
          </a>
        </td>
      </tr>`
    : '';

  const content = `
    <!-- Top accent bar -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:${t.gradient};height:4px;"></td>
      </tr>
    </table>

    <!-- Body content -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:40px 40px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:${t.gradient};border-radius:14px;padding:14px;">
                <div style="font-size:22px;line-height:1;">&#128232;</div>
              </td>
            </tr>
          </table>
          <h1 style="margin:20px 0 12px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
            ${title}
          </h1>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 32px;">
          <div style="font-size:15px;color:#8892a4;line-height:1.7;">
            ${bodyHtml}
          </div>
        </td>
      </tr>
      ${ctaBlock}
      <tr>
        <td style="padding:0 40px 40px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                 style="background:#0f1826;border-radius:10px;border:1px solid #1e2a45;">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0;font-size:12px;color:#4b5670;line-height:1.6;">
                  This is an official announcement from Engganyo. If you have questions, reply to this email or contact support.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return baseLayout(content, title);
}
