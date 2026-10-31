/**
 * Self-contained transactional email: inline styles and presentation tables
 * keep the code readable when email clients strip styles or block images.
 */
export function signInVerificationEmail(otp: string) {
  const code = otp.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);

  return {
    textContent: [
      "Flowlio — Verify your sign-in",
      "",
      "Enter this verification code in the Flowlio sign-in window:",
      otp,
      "",
      "This code expires in 5 minutes. Do not share it with anyone.",
      "If you did not try to sign in, you can ignore this email.",
    ].join("\n"),
    htmlContent: [
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify your sign-in · Flowlio</title></head>',
      '<body style="margin:0;padding:0;background-color:#F3F7F9;color:#172D38;font-family:Arial,Helvetica,sans-serif;">',
      '<div style="display:none;font-size:1px;line-height:1px;color:#F3F7F9;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your Flowlio sign-in code is ready. It expires in 5 minutes.</div>',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F3F7F9"><tr><td align="center" style="padding:32px 12px;">',
      '<!--[if mso]><table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background-color:#FFFFFF;border:1px solid #DFE8EC;border-radius:16px;">',
      '<tr><td bgcolor="#1797B9" style="padding:26px 28px;background-color:#1797B9;border-radius:15px 15px 0 0;color:#FFFFFF;">',
      '<div style="font-family:Trebuchet MS,Arial,sans-serif;font-size:28px;line-height:34px;font-weight:bold;letter-spacing:-1px;color:#FFFFFF;">Flowlio<span style="color:#FFFFFF;">.</span></div>',
      '</td></tr><tr><td style="padding:32px 28px 28px;">',
      '<h1 style="margin:0 0 12px;font-size:26px;line-height:34px;letter-spacing:-0.5px;font-weight:700;color:#172D38;">Verify your sign-in</h1>',
      '<p style="margin:0 0 26px;font-size:16px;line-height:25px;color:#526773;">Enter the code below in your Flowlio sign-in window to continue.</p>',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#EDF8FB" style="padding:22px 8px;background-color:#EDF8FB;border:1px solid #CEE9F1;border-radius:10px;">',
      '<p style="margin:0 0 10px;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:1.6px;color:#526773;">VERIFICATION CODE</p>',
      '<div dir="ltr" style="font-family:Consolas,Monaco,monospace;font-size:36px;line-height:46px;font-weight:700;letter-spacing:6px;white-space:nowrap;color:#172D38;">' + code + '</div>',
      '</td></tr></table>',
      '<p style="margin:16px 0 28px;text-align:center;font-size:13px;line-height:20px;color:#526773;">Valid for <strong style="color:#172D38;">5 minutes</strong> · Use this code only once</p>',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-top:1px solid #DFE8EC;padding-top:22px;">',
      '<p style="margin:0 0 6px;font-size:14px;line-height:22px;font-weight:bold;color:#172D38;">Keep this code private.</p>',
      '<p style="margin:0;font-size:13px;line-height:21px;color:#526773;">Do not share it with anyone. If you did not try to sign in, you can ignore this email.</p>',
      '</td></tr></table></td></tr></table>',
      '<!--[if mso]></td></tr></table><![endif]-->',
      '<p style="margin:20px 0 0;font-size:12px;line-height:20px;color:#526773;">Flowlio · Account security<br>This is an automated message.</p>',
      '</td></tr></table></body></html>',
    ].join(""),
  };
}
