export async function onRequestGet({ request, env }) {
  const ref = new URL(request.url).searchParams.get('ref');
  if (!ref || !/^[A-Za-z0-9]+$/.test(ref) || !env.ORDERS) return Response.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });
  const stored = await env.ORDERS.get(ref);
  if (!stored) return Response.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });
  const order = JSON.parse(stored);
  return Response.json({ referenceId: order.orderId, product: order.product, qty: order.qty, total: order.total, status: order.status });
}
