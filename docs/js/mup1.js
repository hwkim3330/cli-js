/**
 * MUP1 (Microchip UART Protocol 1) - Browser Implementation
 */

const MUP1 = {
  // Frame markers
  SOF: 0x3E,  // '>'
  EOF: 0x3C,  // '<'
  ESC: 0x5C,  // '\\'
  ESC_00: 0x30,  // '0'
  ESC_FF: 0x46,  // 'F'

  // Frame types
  FrameType: {
    ANNOUNCE: 0x50,      // 'P'
    COAP: 0x63,          // 'c'
    COAP_RESPONSE: 0x43, // 'C'
    PING_REQ: 0x70,      // 'p'
    TRACE: 0x54          // 'T'
  },

  /**
   * Calculate Internet Checksum (RFC 1071)
   */
  calculateChecksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i += 2) {
      if (i + 1 < data.length) {
        sum += (data[i] << 8) + data[i + 1];
      } else {
        sum += data[i] << 8;
      }
    }
    sum = (sum >> 16) + (sum & 0xFFFF);
    sum = (sum >> 16) + (sum & 0xFFFF);
    sum = (~sum) & 0xFFFF;
    return sum.toString(16).padStart(4, '0');
  },

  /**
   * Escape special bytes
   */
  escapeData(data) {
    const escaped = [];
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      if (byte === this.SOF || byte === this.EOF || byte === this.ESC) {
        escaped.push(this.ESC);
        escaped.push(byte);
      } else {
        escaped.push(byte);
      }
    }
    return new Uint8Array(escaped);
  },

  /**
   * Unescape data
   */
  unescapeData(data) {
    const unescaped = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === this.ESC && i + 1 < data.length) {
        const next = data[i + 1];
        if (next === this.ESC_00) {
          unescaped.push(0x00);
        } else if (next === this.ESC_FF) {
          unescaped.push(0xFF);
        } else {
          unescaped.push(next);
        }
        i += 2;
      } else {
        unescaped.push(data[i]);
        i++;
      }
    }
    return new Uint8Array(unescaped);
  },

  /**
   * Build MUP1 frame
   */
  buildFrame(payload, type = this.FrameType.COAP) {
    // Build frame for checksum
    const frameForChecksum = new Uint8Array([
      this.SOF, type,
      ...payload,
      this.EOF,
      ...(payload.length % 2 === 0 ? [this.EOF] : [])
    ]);

    const checksumStr = this.calculateChecksum(frameForChecksum);
    const checksumBytes = new TextEncoder().encode(checksumStr);

    // Build actual frame with escaping
    const escapedPayload = this.escapeData(payload);
    const parts = [
      this.SOF,
      type,
      ...escapedPayload,
      this.EOF,
      ...(payload.length % 2 === 0 ? [this.EOF] : []),
      ...checksumBytes
    ];

    return new Uint8Array(parts);
  },

  /**
   * Parse MUP1 frame
   */
  parseFrame(data) {
    let offset = 0;

    if (data[offset] !== this.SOF) {
      return null;
    }
    offset++;

    const type = data[offset++];

    // Find EOF
    let eofIndex = -1;
    for (let i = offset; i < data.length; i++) {
      if (data[i] === this.EOF) {
        if (i > offset && data[i - 1] === this.ESC) {
          continue;
        }
        eofIndex = i;
        break;
      }
    }

    if (eofIndex === -1) return null;

    const escapedPayload = data.slice(offset, eofIndex);
    const payload = this.unescapeData(escapedPayload);

    offset = eofIndex + 1;
    if (offset < data.length && data[offset] === this.EOF) {
      offset++;
    }

    if (offset + 4 > data.length) return null;

    const receivedChecksum = new TextDecoder().decode(data.slice(offset, offset + 4));

    // Verify checksum
    const frameForChecksum = new Uint8Array([
      this.SOF, type,
      ...payload,
      this.EOF,
      ...(payload.length % 2 === 0 ? [this.EOF] : [])
    ]);

    const calculatedChecksum = this.calculateChecksum(frameForChecksum);
    if (receivedChecksum !== calculatedChecksum) {
      console.error('Checksum mismatch:', receivedChecksum, calculatedChecksum);
      return null;
    }

    return { type, payload, isValid: true };
  }
};

/**
 * Frame buffer for handling fragmented data
 */
class FrameBuffer {
  constructor() {
    this.buffer = new Uint8Array(0);
  }

  addData(data) {
    const newBuffer = new Uint8Array(this.buffer.length + data.length);
    newBuffer.set(this.buffer);
    newBuffer.set(data, this.buffer.length);
    this.buffer = newBuffer;

    const frames = [];

    while (true) {
      const sofIndex = this.buffer.indexOf(MUP1.SOF);
      if (sofIndex === -1) {
        this.buffer = new Uint8Array(0);
        break;
      }

      if (sofIndex > 0) {
        this.buffer = this.buffer.slice(sofIndex);
      }

      if (this.buffer.length < 7) break;

      let eofIndex = -1;
      for (let i = 1; i < this.buffer.length; i++) {
        if (this.buffer[i] === MUP1.EOF) {
          if (i > 1 && this.buffer[i - 1] === MUP1.ESC) continue;
          eofIndex = i;
          break;
        }
      }

      if (eofIndex === -1) {
        if (this.buffer.length > 4096) {
          this.buffer = this.buffer.slice(1);
        }
        break;
      }

      let checksumOffset = eofIndex + 1;
      if (checksumOffset < this.buffer.length && this.buffer[checksumOffset] === MUP1.EOF) {
        checksumOffset++;
      }

      if (this.buffer.length < checksumOffset + 4) break;

      const frameEnd = checksumOffset + 4;
      const frameData = this.buffer.slice(0, frameEnd);
      const frame = MUP1.parseFrame(frameData);

      if (frame) {
        frames.push(frame);
        this.buffer = this.buffer.slice(frameEnd);
      } else {
        this.buffer = this.buffer.slice(1);
      }
    }

    return frames;
  }

  clear() {
    this.buffer = new Uint8Array(0);
  }
}

window.MUP1 = MUP1;
window.FrameBuffer = FrameBuffer;
