import * as quotesService from './quotes.service.js';

export async function generate(req, res) {
  const quote = await quotesService.generateQuote(req.validated.params.id);
  res.status(201).json({ data: quote });
}

export async function get(req, res) {
  const quote = await quotesService.getQuote(req.validated.params.id, req.user);
  res.json({ data: quote });
}

export async function adjust(req, res) {
  const quote = await quotesService.adjustQuote(req.validated.params.id, req.validated.body);
  res.json({ data: quote });
}

export async function send(req, res) {
  const result = await quotesService.sendQuote(req.validated.params.id, req.user);
  res.json({ data: result });
}
