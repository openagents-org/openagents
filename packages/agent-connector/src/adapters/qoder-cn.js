/**
 * Qoder CLI CN adapter — the China edition of Qoder (qoder.com.cn).
 *
 * The same CLI as QoderAdapter, built under another brand: its own binary
 * (`qoderclicn`), install script, config root (~/.qoder-cn), env prefix
 * (QODERCN_) and account. Flags and the stream-json contract are identical
 * (verified on 1.1.72), so only the edition table changes. It is a separate
 * agent type rather than a region option because install, detection and the
 * sign-in probe all key off the binary, and the two binaries are not
 * interchangeable — each talks only to its own service.
 */

'use strict';

const QoderAdapter = require('./qoder');
const { EDITIONS } = require('./qoder-runtime');

class QoderCnAdapter extends QoderAdapter {
  static get edition() {
    return EDITIONS.cn;
  }
}

module.exports = QoderCnAdapter;
