/**
 * Simple CBOR Encoder for Browser
 * Supports: integers, strings, arrays, maps, booleans, null
 */

const CBOREncoder = {
  encode(value) {
    const parts = [];
    this._encode(value, parts);
    return new Uint8Array(parts);
  },

  _encode(value, parts) {
    if (value === null || value === undefined) {
      parts.push(0xF6); // null
      return;
    }

    if (typeof value === 'boolean') {
      parts.push(value ? 0xF5 : 0xF4);
      return;
    }

    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        this._encodeInteger(value, parts);
      } else {
        // Float - encode as double (type 7, additional 27)
        parts.push(0xFB);
        const buffer = new ArrayBuffer(8);
        new DataView(buffer).setFloat64(0, value, false);
        parts.push(...new Uint8Array(buffer));
      }
      return;
    }

    if (typeof value === 'string') {
      this._encodeString(value, parts);
      return;
    }

    if (Array.isArray(value)) {
      this._encodeArray(value, parts);
      return;
    }

    if (value instanceof Uint8Array) {
      this._encodeBytes(value, parts);
      return;
    }

    if (typeof value === 'object') {
      this._encodeMap(value, parts);
      return;
    }

    throw new Error(`Unsupported type: ${typeof value}`);
  },

  _encodeInteger(value, parts) {
    if (value >= 0) {
      // Positive integer (major type 0)
      this._encodeTypeAndValue(0, value, parts);
    } else {
      // Negative integer (major type 1)
      this._encodeTypeAndValue(1, -1 - value, parts);
    }
  },

  _encodeTypeAndValue(majorType, value, parts) {
    const type = majorType << 5;

    if (value < 24) {
      parts.push(type | value);
    } else if (value < 256) {
      parts.push(type | 24);
      parts.push(value);
    } else if (value < 65536) {
      parts.push(type | 25);
      parts.push((value >> 8) & 0xFF);
      parts.push(value & 0xFF);
    } else if (value < 4294967296) {
      parts.push(type | 26);
      parts.push((value >> 24) & 0xFF);
      parts.push((value >> 16) & 0xFF);
      parts.push((value >> 8) & 0xFF);
      parts.push(value & 0xFF);
    } else {
      // 64-bit - use BigInt for safety
      parts.push(type | 27);
      const big = BigInt(value);
      for (let i = 7; i >= 0; i--) {
        parts.push(Number((big >> BigInt(i * 8)) & BigInt(0xFF)));
      }
    }
  },

  _encodeString(value, parts) {
    const encoded = new TextEncoder().encode(value);
    this._encodeTypeAndValue(3, encoded.length, parts);
    parts.push(...encoded);
  },

  _encodeBytes(value, parts) {
    this._encodeTypeAndValue(2, value.length, parts);
    parts.push(...value);
  },

  _encodeArray(value, parts) {
    this._encodeTypeAndValue(4, value.length, parts);
    for (const item of value) {
      this._encode(item, parts);
    }
  },

  _encodeMap(value, parts) {
    const entries = Object.entries(value);
    this._encodeTypeAndValue(5, entries.length, parts);

    for (const [key, val] of entries) {
      // Keys are encoded as integers if they look like numbers, otherwise as strings
      const numKey = parseInt(key, 10);
      if (!isNaN(numKey) && String(numKey) === key) {
        this._encodeInteger(numKey, parts);
      } else {
        this._encodeString(key, parts);
      }
      this._encode(val, parts);
    }
  }
};

window.CBOREncoder = CBOREncoder;
