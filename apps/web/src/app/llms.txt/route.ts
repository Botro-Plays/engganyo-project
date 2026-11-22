// /llms.txt: a plain-text index of the public site for agents that look
// for it. Keep it short and factual.
const BODY = `# Engganyo

Engganyo is a web platform where creators complete small tasks for each
other, earn credits, and spend them on campaigns for their own accounts.
Credits are used inside Engganyo and cannot be withdrawn as money.

## Public pages
- https://engganyo.com/
- https://engganyo.com/howitworks
- https://engganyo.com/pricing
- https://engganyo.com/safety
- https://engganyo.com/about
- https://engganyo.com/faq
- https://engganyo.com/contact
- https://engganyo.com/privacy
- https://engganyo.com/terms
`;

export function GET() {
  return new Response(BODY, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
