export function requestUserId(headers: Headers) {
  return headers.get('oai-authenticated-user-id') ?? 'local-owner';
}
