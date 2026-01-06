/**
 * CoAP Protocol - Browser Implementation
 */

const CoAP = {
  MessageType: { CON: 0, NON: 1, ACK: 2, RST: 3 },

  MethodCode: {
    GET: 0x01,
    POST: 0x02,
    PUT: 0x03,
    DELETE: 0x04,
    FETCH: 0x05,
    PATCH: 0x06,
    IPATCH: 0x07
  },

  ResponseCode: {
    CREATED: 0x41,
    DELETED: 0x42,
    VALID: 0x43,
    CHANGED: 0x44,
    CONTENT: 0x45,
    CONTINUE: 0x5F,
    BAD_REQUEST: 0x80,
    NOT_FOUND: 0x84
  },

  OptionNumber: {
    URI_PATH: 11,
    CONTENT_FORMAT: 12,
    URI_QUERY: 15,
    ACCEPT: 17,
    BLOCK2: 23,
    BLOCK1: 27
  },

  ContentFormat: {
    CBOR: 60,
    YANG_DATA_CBOR_SID: 140,
    YANG_IDENTIFIERS_CBOR: 141,
    YANG_INSTANCES_CBOR: 142
  },

  /**
   * Encode option value
   */
  encodeOptionValue(value) {
    if (value instanceof Uint8Array) return value;
    if (typeof value === 'string') {
      return new TextEncoder().encode(value);
    }
    if (typeof value === 'number') {
      if (value === 0) return new Uint8Array(0);
      const bytes = [];
      let temp = value;
      while (temp > 0) {
        bytes.unshift(temp & 0xFF);
        temp >>= 8;
      }
      return new Uint8Array(bytes);
    }
    return new Uint8Array(0);
  },

  /**
   * Encode CoAP options
   */
  encodeOptions(options) {
    options.sort((a, b) => a.number - b.number);
    const parts = [];
    let previousNumber = 0;

    for (const option of options) {
      const delta = option.number - previousNumber;
      const value = this.encodeOptionValue(option.value);
      const length = value.length;

      let optionHeader = 0;
      let extendedDelta = null;
      let extendedLength = null;

      if (delta < 13) {
        optionHeader |= (delta << 4);
      } else if (delta < 269) {
        optionHeader |= (13 << 4);
        extendedDelta = [delta - 13];
      } else {
        optionHeader |= (14 << 4);
        extendedDelta = [(delta - 269) >> 8, (delta - 269) & 0xFF];
      }

      if (length < 13) {
        optionHeader |= length;
      } else if (length < 269) {
        optionHeader |= 13;
        extendedLength = [length - 13];
      } else {
        optionHeader |= 14;
        extendedLength = [(length - 269) >> 8, (length - 269) & 0xFF];
      }

      parts.push(optionHeader);
      if (extendedDelta) parts.push(...extendedDelta);
      if (extendedLength) parts.push(...extendedLength);
      parts.push(...value);

      previousNumber = option.number;
    }

    return new Uint8Array(parts);
  },

  /**
   * Build CoAP message
   */
  buildMessage(options) {
    const {
      type = this.MessageType.CON,
      code,
      messageId = Math.floor(Math.random() * 65536),
      token = new Uint8Array(0),
      options: coapOptions = [],
      payload = null
    } = options;

    const parts = [];

    // Header
    const header = new Uint8Array(4);
    header[0] = (1 << 6) | (type << 4) | token.length;
    header[1] = code;
    header[2] = (messageId >> 8) & 0xFF;
    header[3] = messageId & 0xFF;
    parts.push(...header);

    // Token
    if (token.length > 0) {
      parts.push(...token);
    }

    // Options
    if (coapOptions.length > 0) {
      const encodedOptions = this.encodeOptions(coapOptions);
      parts.push(...encodedOptions);
    }

    // Payload
    if (payload && payload.length > 0) {
      parts.push(0xFF);
      parts.push(...payload);
    }

    return new Uint8Array(parts);
  },

  /**
   * Build GET request
   */
  buildGetRequest(options = {}) {
    const messageId = options.messageId || Math.floor(Math.random() * 65536);
    const token = options.token || new Uint8Array([
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256)
    ]);

    const coapOptions = [
      { number: this.OptionNumber.URI_PATH, value: 'c' },
      { number: this.OptionNumber.ACCEPT, value: this.ContentFormat.YANG_DATA_CBOR_SID }
    ];

    if (options.block2) {
      coapOptions.push({ number: this.OptionNumber.BLOCK2, value: options.block2 });
    }

    return {
      frame: this.buildMessage({
        type: this.MessageType.CON,
        code: this.MethodCode.GET,
        messageId,
        token,
        options: coapOptions
      }),
      messageId,
      token
    };
  },

  /**
   * Build PING frame
   */
  buildPingFrame() {
    return MUP1.buildFrame(new Uint8Array(0), MUP1.FrameType.PING_REQ);
  },

  /**
   * Encode Block2 value
   */
  encodeBlock2Value(num, m, szx) {
    return (num << 4) | ((m ? 1 : 0) << 3) | szx;
  },

  /**
   * Decode Block2 value
   */
  decodeBlock2Value(value) {
    let intValue = 0;
    for (let i = 0; i < value.length; i++) {
      intValue = (intValue << 8) | value[i];
    }
    const szx = intValue & 0x07;
    const m = ((intValue >> 3) & 0x01) === 1;
    const num = intValue >> 4;
    const size = 1 << (szx + 4);
    return { num, m, szx, size };
  },

  /**
   * Parse CoAP response
   */
  parseResponse(data) {
    if (data.length < 4) {
      throw new Error('Invalid CoAP message');
    }

    let offset = 0;

    const version = (data[0] >> 6) & 0x03;
    const type = (data[0] >> 4) & 0x03;
    const tokenLength = data[0] & 0x0F;
    const code = data[1];
    const messageId = (data[2] << 8) | data[3];
    offset += 4;

    const token = data.slice(offset, offset + tokenLength);
    offset += tokenLength;

    const options = [];
    let previousNumber = 0;

    while (offset < data.length && data[offset] !== 0xFF) {
      const optionHeader = data[offset++];
      let delta = (optionHeader >> 4) & 0x0F;
      let length = optionHeader & 0x0F;

      if (delta === 13) {
        delta = data[offset++] + 13;
      } else if (delta === 14) {
        delta = (data[offset] << 8 | data[offset + 1]) + 269;
        offset += 2;
      }

      if (length === 13) {
        length = data[offset++] + 13;
      } else if (length === 14) {
        length = (data[offset] << 8 | data[offset + 1]) + 269;
        offset += 2;
      }

      const number = previousNumber + delta;
      const value = data.slice(offset, offset + length);
      offset += length;

      options.push({ number, value });
      previousNumber = number;
    }

    let payload = null;
    if (offset < data.length && data[offset] === 0xFF) {
      offset++;
      payload = data.slice(offset);
    }

    return {
      version,
      type,
      code,
      messageId,
      token,
      options,
      payload,
      isSuccess: () => (code >> 5) === 2,
      getCodeClass: () => code >> 5,
      getCodeDetail: () => code & 0x1F,
      getBlock2Value: () => {
        const opt = options.find(o => o.number === CoAP.OptionNumber.BLOCK2);
        return opt ? CoAP.decodeBlock2Value(opt.value) : null;
      }
    };
  }
};

window.CoAP = CoAP;
