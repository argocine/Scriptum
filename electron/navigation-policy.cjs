'use strict';

const ALLOWED_EXTERNAL_URLS = new Set([
  'https://fountain.io/syntax',
  'https://fountain.io/syntax/',
]);

function isAllowedExternalUrl(candidate) {
  if (typeof candidate !== 'string') return false;
  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.search || url.hash) return false;
    return ALLOWED_EXTERNAL_URLS.has(url.href);
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternalUrl };
