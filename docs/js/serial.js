/**
 * Web Serial API Manager
 */

class SerialManager extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.frameBuffer = new FrameBuffer();
    this.isConnected = false;
    this.boardReady = false;
    this.pendingRequests = new Map();
    this.requestTimeout = 30000;
    this.readLoop = null;
  }

  /**
   * Check if Web Serial is supported
   */
  static isSupported() {
    return 'serial' in navigator;
  }

  /**
   * Request port and connect
   */
  async connect() {
    if (!SerialManager.isSupported()) {
      throw new Error('Web Serial API not supported. Use Chrome or Edge.');
    }

    try {
      // Request port from user
      this.port = await navigator.serial.requestPort();

      // Open with 115200 baud
      await this.port.open({ baudRate: 115200 });

      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();

      this.isConnected = true;
      this.dispatchEvent(new CustomEvent('connected'));

      // Start reading
      this.startReading();

      // Send PING to initiate handshake
      await this.sendPing();

    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Disconnect
   */
  async disconnect() {
    this.isConnected = false;
    this.boardReady = false;

    // Cancel pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (e) {
      console.error('Disconnect error:', e);
    }

    this.frameBuffer.clear();
    this.dispatchEvent(new CustomEvent('disconnected'));
  }

  /**
   * Start reading from serial port
   */
  async startReading() {
    try {
      while (this.isConnected && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;

        if (value) {
          const frames = this.frameBuffer.addData(value);
          for (const frame of frames) {
            this.handleFrame(frame);
          }
        }
      }
    } catch (error) {
      if (this.isConnected) {
        console.error('Read error:', error);
        this.dispatchEvent(new CustomEvent('error', { detail: error }));
      }
    }
  }

  /**
   * Handle parsed MUP1 frame
   */
  handleFrame(frame) {
    if (frame.type === MUP1.FrameType.COAP || frame.type === MUP1.FrameType.COAP_RESPONSE) {
      try {
        const response = CoAP.parseResponse(frame.payload);

        const pending = this.pendingRequests.get(response.messageId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.messageId);
          pending.resolve(response);
        }

        this.dispatchEvent(new CustomEvent('response', { detail: response }));
      } catch (err) {
        console.error('CoAP parse error:', err);
      }
    } else if (frame.type === MUP1.FrameType.ANNOUNCE) {
      console.log('[MUP1] Board ready');
      this.boardReady = true;
      this.dispatchEvent(new CustomEvent('ready'));
    } else if (frame.type === MUP1.FrameType.TRACE) {
      const msg = new TextDecoder().decode(frame.payload);
      console.warn('[TRACE]', msg);
      this.dispatchEvent(new CustomEvent('trace', { detail: msg }));
    }
  }

  /**
   * Send PING frame
   */
  async sendPing() {
    const pingFrame = MUP1.buildFrame(new Uint8Array(0), MUP1.FrameType.PING_REQ);
    await this.writer.write(pingFrame);
    console.log('[MUP1] PING sent');
  }

  /**
   * Send CoAP request and wait for response
   */
  async sendRequest(coapFrame, messageId) {
    if (!this.isConnected) {
      throw new Error('Not connected');
    }
    if (!this.boardReady) {
      throw new Error('Board not ready');
    }

    const mup1Frame = MUP1.buildFrame(coapFrame, MUP1.FrameType.COAP);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      this.pendingRequests.set(messageId, { resolve, reject, timeout });

      this.writer.write(mup1Frame).catch(err => {
        clearTimeout(timeout);
        this.pendingRequests.delete(messageId);
        reject(err);
      });
    });
  }

  /**
   * Send GET request with block-wise transfer support
   */
  async sendGetRequest() {
    if (!this.boardReady) {
      throw new Error('Board not ready');
    }

    const payloads = [];
    const token = new Uint8Array([
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256)
    ]);

    // Initial request
    const { frame: initialFrame, messageId: initialMsgId } = CoAP.buildGetRequest({ token });
    const firstResponse = await this.sendRequest(initialFrame, initialMsgId);

    if (!firstResponse.isSuccess()) {
      throw new Error(`CoAP error: ${firstResponse.getCodeClass()}.${firstResponse.getCodeDetail()}`);
    }

    if (firstResponse.payload) {
      payloads.push(firstResponse.payload);
    }

    // Check for block-wise transfer
    let block2 = firstResponse.getBlock2Value();
    let more = block2 ? block2.m : false;
    let blockNum = block2 ? block2.num : 0;

    while (more) {
      blockNum++;
      const messageId = Math.floor(Math.random() * 65536);
      const block2Value = CoAP.encodeBlock2Value(blockNum, false, block2.szx);

      const { frame } = CoAP.buildGetRequest({
        messageId,
        token,
        block2: block2Value
      });

      const response = await this.sendRequest(frame, messageId);

      if (!response.isSuccess()) {
        throw new Error(`Block ${blockNum} failed`);
      }

      if (response.payload) {
        payloads.push(response.payload);
      }

      const nextBlock2 = response.getBlock2Value();
      if (nextBlock2) {
        more = nextBlock2.m;
        block2 = nextBlock2;
      } else {
        more = false;
      }
    }

    // Concatenate all payloads
    const totalLength = payloads.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of payloads) {
      result.set(p, offset);
      offset += p.length;
    }

    return result;
  }
}

window.SerialManager = SerialManager;
