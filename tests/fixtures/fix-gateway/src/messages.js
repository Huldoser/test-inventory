const SOH = '\u0001';

/** The FIX checksum: the sum of every byte before the checksum field, modulo 256, as three digits. */
function checksum(text) {
  let sum = 0;
  for (const char of text) sum += char.charCodeAt(0);
  return String(sum % 256).padStart(3, '0');
}

/** A FIX 4.4 message from its type and body fields, with BodyLength (9) and CheckSum (10) worked out. */
function encode(type, fields) {
  const body = [`35=${type}`, ...Object.entries(fields).map(([tag, value]) => `${tag}=${value}`)].join(SOH) + SOH;
  const head = `8=FIX.4.4${SOH}9=${body.length}${SOH}`;
  return `${head}${body}10=${checksum(head + body)}${SOH}`;
}

/** The fields of a FIX message by tag, the checksum checked. */
function decode(message) {
  const fields = {};
  for (const pair of message.split(SOH).filter(Boolean)) {
    const at = pair.indexOf('=');
    fields[pair.slice(0, at)] = pair.slice(at + 1);
  }
  const trailer = message.lastIndexOf(`${SOH}10=`) + 1;
  if (checksum(message.slice(0, trailer)) !== fields['10']) throw new Error('Checksum does not match');
  return fields;
}

module.exports = { SOH, checksum, encode, decode };
