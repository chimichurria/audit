export async function POST(req: Request) {
  const body = await req.json();
  console.log('evento', body);
  return new Response('ok');
}
