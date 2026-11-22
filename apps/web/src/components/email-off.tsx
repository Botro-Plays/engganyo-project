// Emits literal <!--email_off--> ... <!--/email_off--> comment markers
// around children. Cloudflare Email Address Obfuscation skips content
// inside the markers, so the public contact address stays a normal,
// visible mailto link without any zone-setting change. Server-safe.
export function EmailOff({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span dangerouslySetInnerHTML={{ __html: '<!--email_off-->' }} />
      {children}
      <span dangerouslySetInnerHTML={{ __html: '<!--/email_off-->' }} />
    </>
  );
}
