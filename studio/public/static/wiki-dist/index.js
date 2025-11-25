import Z0, { createContext as rt, useContext as tt, useMemo as at, useState as E0, useEffect as g0 } from "react";
import { useNavigate as rr, useParams as nt, Routes as ot, Route as ge } from "react-router-dom";
import { create as oe } from "zustand";
import "sonner";
import it from "@uiw/react-md-editor";
import st from "react-markdown";
import xt from "remark-gfm";
import ct from "rehype-highlight";
import lt from "rehype-raw";
import { diffLines as dt } from "diff";
var M = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function ft(m) {
  return m && m.__esModule && Object.prototype.hasOwnProperty.call(m, "default") ? m.default : m;
}
function ut(m) {
  if (m.__esModule)
    return m;
  var F = m.default;
  if (typeof F == "function") {
    var i = function e() {
      return this instanceof e ? Reflect.construct(F, arguments, this.constructor) : F.apply(this, arguments);
    };
    i.prototype = F.prototype;
  } else
    i = {};
  return Object.defineProperty(i, "__esModule", { value: !0 }), Object.keys(m).forEach(function(e) {
    var x = Object.getOwnPropertyDescriptor(m, e);
    Object.defineProperty(i, e, x.get ? x : {
      enumerable: !0,
      get: function() {
        return m[e];
      }
    });
  }), i;
}
var Je = { exports: {} }, Y0 = {};
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var sr;
function vt() {
  if (sr)
    return Y0;
  sr = 1;
  var m = Z0, F = Symbol.for("react.element"), i = Symbol.for("react.fragment"), e = Object.prototype.hasOwnProperty, x = m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, a = { key: !0, ref: !0, __self: !0, __source: !0 };
  function b(u, v, r) {
    var t, E = {}, o = null, h = null;
    r !== void 0 && (o = "" + r), v.key !== void 0 && (o = "" + v.key), v.ref !== void 0 && (h = v.ref);
    for (t in v)
      e.call(v, t) && !a.hasOwnProperty(t) && (E[t] = v[t]);
    if (u && u.defaultProps)
      for (t in v = u.defaultProps, v)
        E[t] === void 0 && (E[t] = v[t]);
    return { $$typeof: F, type: u, key: o, ref: h, props: E, _owner: x.current };
  }
  return Y0.Fragment = i, Y0.jsx = b, Y0.jsxs = b, Y0;
}
var G0 = {};
/**
 * @license React
 * react-jsx-runtime.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var xr;
function ht() {
  return xr || (xr = 1, process.env.NODE_ENV !== "production" && function() {
    var m = Z0, F = Symbol.for("react.element"), i = Symbol.for("react.portal"), e = Symbol.for("react.fragment"), x = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), b = Symbol.for("react.provider"), u = Symbol.for("react.context"), v = Symbol.for("react.forward_ref"), r = Symbol.for("react.suspense"), t = Symbol.for("react.suspense_list"), E = Symbol.for("react.memo"), o = Symbol.for("react.lazy"), h = Symbol.for("react.offscreen"), s = Symbol.iterator, d = "@@iterator";
    function c(p) {
      if (p === null || typeof p != "object")
        return null;
      var P = s && p[s] || p[d];
      return typeof P == "function" ? P : null;
    }
    var y = m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    function n(p) {
      {
        for (var P = arguments.length, T = new Array(P > 1 ? P - 1 : 0), O = 1; O < P; O++)
          T[O - 1] = arguments[O];
        l("error", p, T);
      }
    }
    function l(p, P, T) {
      {
        var O = y.ReactDebugCurrentFrame, G = O.getStackAddendum();
        G !== "" && (P += "%s", T = T.concat([G]));
        var J = T.map(function(K) {
          return String(K);
        });
        J.unshift("Warning: " + P), Function.prototype.apply.call(console[p], console, J);
      }
    }
    var f = !1, C = !1, _ = !1, A = !1, D = !1, W;
    W = Symbol.for("react.module.reference");
    function B(p) {
      return !!(typeof p == "string" || typeof p == "function" || p === e || p === a || D || p === x || p === r || p === t || A || p === h || f || C || _ || typeof p == "object" && p !== null && (p.$$typeof === o || p.$$typeof === E || p.$$typeof === b || p.$$typeof === u || p.$$typeof === v || // This needs to include all possible module reference object
      // types supported by any Flight configuration anywhere since
      // we don't know which Flight build this will end up being used
      // with.
      p.$$typeof === W || p.getModuleId !== void 0));
    }
    function k(p, P, T) {
      var O = p.displayName;
      if (O)
        return O;
      var G = P.displayName || P.name || "";
      return G !== "" ? T + "(" + G + ")" : T;
    }
    function S(p) {
      return p.displayName || "Context";
    }
    function w(p) {
      if (p == null)
        return null;
      if (typeof p.tag == "number" && n("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."), typeof p == "function")
        return p.displayName || p.name || null;
      if (typeof p == "string")
        return p;
      switch (p) {
        case e:
          return "Fragment";
        case i:
          return "Portal";
        case a:
          return "Profiler";
        case x:
          return "StrictMode";
        case r:
          return "Suspense";
        case t:
          return "SuspenseList";
      }
      if (typeof p == "object")
        switch (p.$$typeof) {
          case u:
            var P = p;
            return S(P) + ".Consumer";
          case b:
            var T = p;
            return S(T._context) + ".Provider";
          case v:
            return k(p, p.render, "ForwardRef");
          case E:
            var O = p.displayName || null;
            return O !== null ? O : w(p.type) || "Memo";
          case o: {
            var G = p, J = G._payload, K = G._init;
            try {
              return w(K(J));
            } catch {
              return null;
            }
          }
        }
      return null;
    }
    var z = Object.assign, L = 0, q, Q, X, Z, Y, R, N;
    function H() {
    }
    H.__reactDisabledLog = !0;
    function j() {
      {
        if (L === 0) {
          q = console.log, Q = console.info, X = console.warn, Z = console.error, Y = console.group, R = console.groupCollapsed, N = console.groupEnd;
          var p = {
            configurable: !0,
            enumerable: !0,
            value: H,
            writable: !0
          };
          Object.defineProperties(console, {
            info: p,
            log: p,
            warn: p,
            error: p,
            group: p,
            groupCollapsed: p,
            groupEnd: p
          });
        }
        L++;
      }
    }
    function e0() {
      {
        if (L--, L === 0) {
          var p = {
            configurable: !0,
            enumerable: !0,
            writable: !0
          };
          Object.defineProperties(console, {
            log: z({}, p, {
              value: q
            }),
            info: z({}, p, {
              value: Q
            }),
            warn: z({}, p, {
              value: X
            }),
            error: z({}, p, {
              value: Z
            }),
            group: z({}, p, {
              value: Y
            }),
            groupCollapsed: z({}, p, {
              value: R
            }),
            groupEnd: z({}, p, {
              value: N
            })
          });
        }
        L < 0 && n("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
      }
    }
    var V = y.ReactCurrentDispatcher, a0;
    function I(p, P, T) {
      {
        if (a0 === void 0)
          try {
            throw Error();
          } catch (G) {
            var O = G.stack.trim().match(/\n( *(at )?)/);
            a0 = O && O[1] || "";
          }
        return `
` + a0 + p;
      }
    }
    var C0 = !1, u0;
    {
      var L0 = typeof WeakMap == "function" ? WeakMap : Map;
      u0 = new L0();
    }
    function _0(p, P) {
      if (!p || C0)
        return "";
      {
        var T = u0.get(p);
        if (T !== void 0)
          return T;
      }
      var O;
      C0 = !0;
      var G = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      var J;
      J = V.current, V.current = null, j();
      try {
        if (P) {
          var K = function() {
            throw Error();
          };
          if (Object.defineProperty(K.prototype, "props", {
            set: function() {
              throw Error();
            }
          }), typeof Reflect == "object" && Reflect.construct) {
            try {
              Reflect.construct(K, []);
            } catch (c0) {
              O = c0;
            }
            Reflect.construct(p, [], K);
          } else {
            try {
              K.call();
            } catch (c0) {
              O = c0;
            }
            p.call(K.prototype);
          }
        } else {
          try {
            throw Error();
          } catch (c0) {
            O = c0;
          }
          p();
        }
      } catch (c0) {
        if (c0 && O && typeof c0.stack == "string") {
          for (var $ = c0.stack.split(`
`), x0 = O.stack.split(`
`), r0 = $.length - 1, t0 = x0.length - 1; r0 >= 1 && t0 >= 0 && $[r0] !== x0[t0]; )
            t0--;
          for (; r0 >= 1 && t0 >= 0; r0--, t0--)
            if ($[r0] !== x0[t0]) {
              if (r0 !== 1 || t0 !== 1)
                do
                  if (r0--, t0--, t0 < 0 || $[r0] !== x0[t0]) {
                    var f0 = `
` + $[r0].replace(" at new ", " at ");
                    return p.displayName && f0.includes("<anonymous>") && (f0 = f0.replace("<anonymous>", p.displayName)), typeof p == "function" && u0.set(p, f0), f0;
                  }
                while (r0 >= 1 && t0 >= 0);
              break;
            }
        }
      } finally {
        C0 = !1, V.current = J, e0(), Error.prepareStackTrace = G;
      }
      var z0 = p ? p.displayName || p.name : "", j0 = z0 ? I(z0) : "";
      return typeof p == "function" && u0.set(p, j0), j0;
    }
    function l0(p, P, T) {
      return _0(p, !1);
    }
    function s0(p) {
      var P = p.prototype;
      return !!(P && P.isReactComponent);
    }
    function b0(p, P, T) {
      if (p == null)
        return "";
      if (typeof p == "function")
        return _0(p, s0(p));
      if (typeof p == "string")
        return I(p);
      switch (p) {
        case r:
          return I("Suspense");
        case t:
          return I("SuspenseList");
      }
      if (typeof p == "object")
        switch (p.$$typeof) {
          case v:
            return l0(p.render);
          case E:
            return b0(p.type, P, T);
          case o: {
            var O = p, G = O._payload, J = O._init;
            try {
              return b0(J(G), P, T);
            } catch {
            }
          }
        }
      return "";
    }
    var v0 = Object.prototype.hasOwnProperty, w0 = {}, A0 = y.ReactDebugCurrentFrame;
    function F0(p) {
      if (p) {
        var P = p._owner, T = b0(p.type, p._source, P ? P.type : null);
        A0.setExtraStackFrame(T);
      } else
        A0.setExtraStackFrame(null);
    }
    function R0(p, P, T, O, G) {
      {
        var J = Function.call.bind(v0);
        for (var K in p)
          if (J(p, K)) {
            var $ = void 0;
            try {
              if (typeof p[K] != "function") {
                var x0 = Error((O || "React class") + ": " + T + " type `" + K + "` is invalid; it must be a function, usually from the `prop-types` package, but received `" + typeof p[K] + "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.");
                throw x0.name = "Invariant Violation", x0;
              }
              $ = p[K](P, K, O, T, null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
            } catch (r0) {
              $ = r0;
            }
            $ && !($ instanceof Error) && (F0(G), n("%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).", O || "React class", T, K, typeof $), F0(null)), $ instanceof Error && !($.message in w0) && (w0[$.message] = !0, F0(G), n("Failed %s type: %s", T, $.message), F0(null));
          }
      }
    }
    var d0 = Array.isArray;
    function o0(p) {
      return d0(p);
    }
    function m0(p) {
      {
        var P = typeof Symbol == "function" && Symbol.toStringTag, T = P && p[Symbol.toStringTag] || p.constructor.name || "Object";
        return T;
      }
    }
    function W0(p) {
      try {
        return O0(p), !1;
      } catch {
        return !0;
      }
    }
    function O0(p) {
      return "" + p;
    }
    function B0(p) {
      if (W0(p))
        return n("The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.", m0(p)), O0(p);
    }
    var h0 = y.ReactCurrentOwner, xe = {
      key: !0,
      ref: !0,
      __self: !0,
      __source: !0
    }, I0, q0, y0;
    y0 = {};
    function S0(p) {
      if (v0.call(p, "ref")) {
        var P = Object.getOwnPropertyDescriptor(p, "ref").get;
        if (P && P.isReactWarning)
          return !1;
      }
      return p.ref !== void 0;
    }
    function ce(p) {
      if (v0.call(p, "key")) {
        var P = Object.getOwnPropertyDescriptor(p, "key").get;
        if (P && P.isReactWarning)
          return !1;
      }
      return p.key !== void 0;
    }
    function Q0(p, P) {
      if (typeof p.ref == "string" && h0.current && P && h0.current.stateNode !== P) {
        var T = w(h0.current.type);
        y0[T] || (n('Component "%s" contains the string ref "%s". Support for string refs will be removed in a future major release. This case cannot be automatically converted to an arrow function. We ask you to manually fix this case by using useRef() or createRef() instead. Learn more about using refs safely here: https://reactjs.org/link/strict-mode-string-ref', w(h0.current.type), p.ref), y0[T] = !0);
      }
    }
    function J0(p, P) {
      {
        var T = function() {
          I0 || (I0 = !0, n("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", P));
        };
        T.isReactWarning = !0, Object.defineProperty(p, "key", {
          get: T,
          configurable: !0
        });
      }
    }
    function le(p, P) {
      {
        var T = function() {
          q0 || (q0 = !0, n("%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", P));
        };
        T.isReactWarning = !0, Object.defineProperty(p, "ref", {
          get: T,
          configurable: !0
        });
      }
    }
    var de = function(p, P, T, O, G, J, K) {
      var $ = {
        // This tag allows us to uniquely identify this as a React Element
        $$typeof: F,
        // Built-in properties that belong on the element
        type: p,
        key: P,
        ref: T,
        props: K,
        // Record the component responsible for creating this element.
        _owner: J
      };
      return $._store = {}, Object.defineProperty($._store, "validated", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: !1
      }), Object.defineProperty($, "_self", {
        configurable: !1,
        enumerable: !1,
        writable: !1,
        value: O
      }), Object.defineProperty($, "_source", {
        configurable: !1,
        enumerable: !1,
        writable: !1,
        value: G
      }), Object.freeze && (Object.freeze($.props), Object.freeze($)), $;
    };
    function ee(p, P, T, O, G) {
      {
        var J, K = {}, $ = null, x0 = null;
        T !== void 0 && (B0(T), $ = "" + T), ce(P) && (B0(P.key), $ = "" + P.key), S0(P) && (x0 = P.ref, Q0(P, G));
        for (J in P)
          v0.call(P, J) && !xe.hasOwnProperty(J) && (K[J] = P[J]);
        if (p && p.defaultProps) {
          var r0 = p.defaultProps;
          for (J in r0)
            K[J] === void 0 && (K[J] = r0[J]);
        }
        if ($ || x0) {
          var t0 = typeof p == "function" ? p.displayName || p.name || "Unknown" : p;
          $ && J0(K, t0), x0 && le(K, t0);
        }
        return de(p, $, x0, G, O, h0.current, K);
      }
    }
    var M0 = y.ReactCurrentOwner, $0 = y.ReactDebugCurrentFrame;
    function k0(p) {
      if (p) {
        var P = p._owner, T = b0(p.type, p._source, P ? P.type : null);
        $0.setExtraStackFrame(T);
      } else
        $0.setExtraStackFrame(null);
    }
    var T0;
    T0 = !1;
    function U0(p) {
      return typeof p == "object" && p !== null && p.$$typeof === F;
    }
    function re() {
      {
        if (M0.current) {
          var p = w(M0.current.type);
          if (p)
            return `

Check the render method of \`` + p + "`.";
        }
        return "";
      }
    }
    function fe(p) {
      {
        if (p !== void 0) {
          var P = p.fileName.replace(/^.*[\\\/]/, ""), T = p.lineNumber;
          return `

Check your code at ` + P + ":" + T + ".";
        }
        return "";
      }
    }
    var K0 = {};
    function ue(p) {
      {
        var P = re();
        if (!P) {
          var T = typeof p == "string" ? p : p.displayName || p.name;
          T && (P = `

Check the top-level render call using <` + T + ">.");
        }
        return P;
      }
    }
    function te(p, P) {
      {
        if (!p._store || p._store.validated || p.key != null)
          return;
        p._store.validated = !0;
        var T = ue(P);
        if (K0[T])
          return;
        K0[T] = !0;
        var O = "";
        p && p._owner && p._owner !== M0.current && (O = " It was passed a child from " + w(p._owner.type) + "."), k0(p), n('Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.', T, O), k0(null);
      }
    }
    function X0(p, P) {
      {
        if (typeof p != "object")
          return;
        if (o0(p))
          for (var T = 0; T < p.length; T++) {
            var O = p[T];
            U0(O) && te(O, P);
          }
        else if (U0(p))
          p._store && (p._store.validated = !0);
        else if (p) {
          var G = c(p);
          if (typeof G == "function" && G !== p.entries)
            for (var J = G.call(p), K; !(K = J.next()).done; )
              U0(K.value) && te(K.value, P);
        }
      }
    }
    function ve(p) {
      {
        var P = p.type;
        if (P == null || typeof P == "string")
          return;
        var T;
        if (typeof P == "function")
          T = P.propTypes;
        else if (typeof P == "object" && (P.$$typeof === v || // Note: Memo only checks outer props here.
        // Inner props are checked in the reconciler.
        P.$$typeof === E))
          T = P.propTypes;
        else
          return;
        if (T) {
          var O = w(P);
          R0(T, p.props, "prop", O, p);
        } else if (P.PropTypes !== void 0 && !T0) {
          T0 = !0;
          var G = w(P);
          n("Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?", G || "Unknown");
        }
        typeof P.getDefaultProps == "function" && !P.getDefaultProps.isReactClassApproved && n("getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.");
      }
    }
    function ae(p) {
      {
        for (var P = Object.keys(p.props), T = 0; T < P.length; T++) {
          var O = P[T];
          if (O !== "children" && O !== "key") {
            k0(p), n("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.", O), k0(null);
            break;
          }
        }
        p.ref !== null && (k0(p), n("Invalid attribute `ref` supplied to `React.Fragment`."), k0(null));
      }
    }
    var i0 = {};
    function p0(p, P, T, O, G, J) {
      {
        var K = B(p);
        if (!K) {
          var $ = "";
          (p === void 0 || typeof p == "object" && p !== null && Object.keys(p).length === 0) && ($ += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.");
          var x0 = fe(G);
          x0 ? $ += x0 : $ += re();
          var r0;
          p === null ? r0 = "null" : o0(p) ? r0 = "array" : p !== void 0 && p.$$typeof === F ? (r0 = "<" + (w(p.type) || "Unknown") + " />", $ = " Did you accidentally export a JSX literal instead of a component?") : r0 = typeof p, n("React.jsx: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s", r0, $);
        }
        var t0 = ee(p, P, T, G, J);
        if (t0 == null)
          return t0;
        if (K) {
          var f0 = P.children;
          if (f0 !== void 0)
            if (O)
              if (o0(f0)) {
                for (var z0 = 0; z0 < f0.length; z0++)
                  X0(f0[z0], p);
                Object.freeze && Object.freeze(f0);
              } else
                n("React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead.");
            else
              X0(f0, p);
        }
        if (v0.call(P, "key")) {
          var j0 = w(p), c0 = Object.keys(P).filter(function(et) {
            return et !== "key";
          }), pe = c0.length > 0 ? "{key: someKey, " + c0.join(": ..., ") + ": ...}" : "{key: someKey}";
          if (!i0[j0 + pe]) {
            var Jr = c0.length > 0 ? "{" + c0.join(": ..., ") + ": ...}" : "{}";
            n(`A props object containing a "key" prop is being spread into JSX:
  let props = %s;
  <%s {...props} />
React keys must be passed directly to JSX without using spread:
  let props = %s;
  <%s key={someKey} {...props} />`, pe, j0, Jr, j0), i0[j0 + pe] = !0;
          }
        }
        return p === e ? ae(t0) : ve(t0), t0;
      }
    }
    function ne(p, P, T) {
      return p0(p, P, T, !0);
    }
    function he(p, P, T) {
      return p0(p, P, T, !1);
    }
    var Zr = he, Qr = ne;
    G0.Fragment = e, G0.jsx = Zr, G0.jsxs = Qr;
  }()), G0;
}
process.env.NODE_ENV === "production" ? Je.exports = vt() : Je.exports = ht();
var g = Je.exports;
const N0 = (m) => {
  if (!m)
    return Date.now() / 1e3;
  if (m > 1e12) {
    const F = m / 1e3;
    return console.log(
      "WikiStore: Converting timestamp from milliseconds to seconds:",
      m,
      "->",
      F
    ), F;
  }
  return console.log("WikiStore: Using timestamp as seconds:", m), m;
}, ie = oe((m, F) => {
  const i = () => {
    const { service: e } = F();
    if (e)
      return console.log("WikiStore: Service found in store"), e;
    const x = window.__OPENAGENTS_CONTEXT__;
    if (console.log("WikiStore: Checking window.__OPENAGENTS_CONTEXT__", {
      exists: !!x,
      hasConnector: !!(x != null && x.connector),
      isConnected: x == null ? void 0 : x.isConnected,
      connectorType: x != null && x.connector ? typeof x.connector : "none"
    }), x != null && x.connector) {
      const a = x.connector;
      if (typeof a.sendEvent != "function")
        return console.error("WikiStore: Connector does not have sendEvent method", a), null;
      const b = {
        sendEvent: async (u) => (console.log("WikiStore: Sending event via adapter service", u.event_name), await a.sendEvent(u)),
        getAgentId: () => {
          var u;
          return ((u = a.getAgentId) == null ? void 0 : u.call(a)) || null;
        }
      };
      return m({ service: b }), console.log("WikiStore: Service adapter created and set to store"), b;
    } else
      console.warn("WikiStore: window.__OPENAGENTS_CONTEXT__ not available or connector missing", {
        hasContext: !!x,
        contextKeys: x ? Object.keys(x) : []
      });
    return null;
  };
  return {
    pages: [],
    selectedPage: null,
    proposals: [],
    pagesLoading: !1,
    pagesError: null,
    service: null,
    eventHandler: null,
    setService: (e) => {
      m({ service: e });
    },
    loadPages: async () => {
      const e = i();
      if (!e) {
        console.warn("WikiStore: Cannot load pages - service not available");
        return;
      }
      try {
        m({ pagesLoading: !0, pagesError: null });
        const x = await e.sendEvent({
          event_name: "wiki.pages.list",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {
            limit: 50,
            offset: 0
          }
        });
        x.success && x.data ? m({
          pages: x.data.pages || [],
          pagesLoading: !1
        }) : m({
          pagesError: x.message || "Failed to load wiki pages",
          pagesLoading: !1
        });
      } catch (x) {
        console.error("Failed to load wiki pages:", x), m({
          pagesError: "Failed to load wiki pages",
          pagesLoading: !1
        });
      }
    },
    loadPage: async (e) => {
      const x = i();
      if (!x) {
        console.warn("WikiStore: Cannot load page - service not available");
        return;
      }
      try {
        const a = await x.sendEvent({
          event_name: "wiki.page.get",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {
            page_path: e
          }
        });
        a.success && a.data && m({ selectedPage: a.data });
      } catch (a) {
        console.error("Failed to load wiki page:", a);
      }
    },
    loadProposals: async () => {
      const e = i();
      if (!e) {
        console.warn("WikiStore: Cannot load proposals - service not available");
        return;
      }
      try {
        const x = await e.sendEvent({
          event_name: "wiki.proposals.list",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {}
        });
        x.success && x.data && m({ proposals: x.data.proposals || [] });
      } catch (x) {
        console.error("Failed to load proposals:", x);
      }
    },
    searchPages: async (e) => {
      const x = i(), { loadPages: a } = F();
      if (!x) {
        console.warn("WikiStore: Cannot search pages - service not available");
        return;
      }
      if (!e.trim()) {
        a();
        return;
      }
      try {
        const b = await x.sendEvent({
          event_name: "wiki.pages.search",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {
            query: e.trim(),
            limit: 50
          }
        });
        b.success && b.data && m({ pages: b.data.pages || [] });
      } catch (b) {
        console.error("Failed to search wiki pages:", b);
      }
    },
    createPage: async (e, x, a) => {
      var u;
      const b = i();
      if (console.log("service", b), console.log("WikiStore: Creating page with data:", b ? "service available" : "service unavailable", e, x, a), !b || !e.trim() || !x.trim() || !a.trim())
        return console.error("WikiStore: Cannot create page - missing service or required fields", {
          hasService: !!b,
          pagePath: e.trim(),
          title: x.trim(),
          content: a.trim()
        }), !1;
      try {
        const v = await b.sendEvent({
          event_name: "wiki.page.create",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {
            page_path: e.trim(),
            title: x.trim(),
            wiki_content: a.trim()
          }
        });
        if (v.success) {
          const r = {
            page_path: e.trim(),
            title: x.trim(),
            wiki_content: a.trim(),
            creator_id: b.getAgentId() || "unknown",
            created_at: Date.now() / 1e3,
            last_modified: Date.now() / 1e3,
            version: 1
          };
          if (console.log("WikiStore: Creating page with data:", r), (u = v.data) != null && u.page) {
            const t = v.data.page, E = N0(t.created_at), o = N0(
              t.last_modified || t.created_at
            );
            console.log(
              "WikiStore: Normalized createPage server response timestamps - created_at:",
              E,
              "last_modified:",
              o
            );
            const h = {
              page_path: t.page_path,
              title: t.title,
              wiki_content: t.wiki_content,
              creator_id: t.creator_id,
              created_at: E,
              last_modified: o,
              version: t.version || 1
            };
            F().updateOrAddPageToList(h);
          } else
            F().updateOrAddPageToList(r);
          return !0;
        } else
          return console.error("Failed to create wiki page:", v.message), !1;
      } catch (v) {
        return console.error("Failed to create wiki page:", v), !1;
      }
    },
    editPage: async (e, x) => {
      const a = i(), { loadPage: b, loadPages: u } = F();
      if (!a || !x.trim())
        return console.warn("WikiStore: Cannot edit page - service not available or content empty"), !1;
      try {
        const v = await a.sendEvent({
          event_name: "wiki.page.edit",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {
            page_path: e,
            wiki_content: x.trim()
          }
        });
        return v.success ? (b(e), u(), !0) : (m({ pagesError: v.message || "Failed to edit wiki page" }), !1);
      } catch (v) {
        return console.error("Failed to edit wiki page:", v), m({ pagesError: "Failed to edit wiki page" }), !1;
      }
    },
    proposeEdit: async (e, x, a) => {
      const b = i(), { loadProposals: u } = F();
      if (!b || !x.trim() || !a.trim())
        return console.warn("WikiStore: Cannot propose edit - service not available or required fields missing"), !1;
      if (!e || !e.trim())
        return m({ pagesError: "Page path is required for proposals" }), !1;
      try {
        const v = {
          page_path: e.trim(),
          wiki_content: x.trim(),
          rationale: a.trim()
        };
        console.log("Sending proposal event with payload:", v);
        const r = await b.sendEvent({
          event_name: "wiki.page.proposal.create",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: v
        });
        return r.success ? (u(), !0) : (m({ pagesError: r.message || "Failed to propose edit" }), !1);
      } catch (v) {
        return console.error("Failed to propose edit:", v), m({ pagesError: "Failed to propose edit" }), !1;
      }
    },
    resolveProposal: async (e, x) => {
      const { service: a, loadProposals: b, loadPages: u } = F();
      if (!a)
        return !1;
      try {
        const v = await a.sendEvent({
          event_name: "wiki.proposal.resolve",
          destination_id: "mod:openagents.mods.workspace.wiki",
          payload: {
            proposal_id: e,
            action: x
          }
        });
        return v.success ? (b(), u(), !0) : (m({ pagesError: v.message || `Failed to ${x} proposal` }), !1);
      } catch (v) {
        return console.error(`Failed to ${x} proposal:`, v), m({ pagesError: `Failed to ${x} proposal` }), !1;
      }
    },
    clearError: () => {
      m({ pagesError: null });
    },
    setSelectedPage: (e) => {
      m({ selectedPage: e });
    },
    // Real-time updates - update or add page to list
    updateOrAddPageToList: (e) => {
      m((x) => {
        var b;
        const a = x.pages.findIndex(
          (u) => u.page_path === e.page_path
        );
        if (a >= 0) {
          console.log(
            "WikiStore: Updating existing page in list:",
            e.page_path
          );
          const u = [...x.pages];
          u[a] = e;
          const v = ((b = x.selectedPage) == null ? void 0 : b.page_path) === e.page_path ? e : x.selectedPage;
          return {
            ...x,
            pages: u,
            selectedPage: v
          };
        } else
          return console.log("WikiStore: Adding new page to list:", e.title), {
            ...x,
            pages: [e, ...x.pages]
          };
      });
    },
    // Function specifically for updating page content, only updates necessary fields
    updatePageContent: (e, x, a, b) => {
      m((u) => {
        var r;
        const v = u.pages.findIndex(
          (t) => t.page_path === e
        );
        if (v >= 0) {
          console.log("WikiStore: Updating page content for:", e);
          const t = [...u.pages], E = t[v];
          t[v] = {
            ...E,
            wiki_content: x,
            last_modified: a || Date.now() / 1e3,
            version: b || E.version
          };
          const o = ((r = u.selectedPage) == null ? void 0 : r.page_path) === e ? t[v] : u.selectedPage;
          return {
            ...u,
            pages: t,
            selectedPage: o
          };
        } else
          return console.warn(
            "WikiStore: Cannot update content for non-existent page:",
            e
          ), u;
      });
    },
    setupEventListeners: () => {
      if (!i()) {
        console.warn("WikiStore: Cannot setup event listeners - service not available");
        return;
      }
      console.log("WikiStore: Setting up wiki event listeners");
      const x = window.__EVENT_ROUTER__, a = (b) => {
        var u, v, r, t, E, o, h;
        if (b.event_name === "wiki.page.created" && ((u = b.payload) != null && u.page)) {
          console.log("WikiStore: Received wiki.page.created event:", b);
          const s = b.payload.page, d = N0(s.created_at), c = N0(
            s.last_modified || s.created_at
          );
          console.log(
            "WikiStore: Normalized wiki.page.created timestamps - created_at:",
            d,
            "last_modified:",
            c
          );
          const y = {
            page_path: s.page_path,
            title: s.title,
            wiki_content: s.wiki_content || "",
            creator_id: s.creator_id,
            created_at: d,
            last_modified: c,
            version: s.version || 1
          };
          F().updateOrAddPageToList(y);
        } else if (b.event_name === "wiki.proposal.notification")
          console.log(
            "WikiStore: Received wiki.proposal.notification event:",
            b
          ), F().loadProposals();
        else if (b.event_name === "wiki.page.notification") {
          console.log("WikiStore: Received wiki.page.notification event:", b);
          let s = null;
          if ((v = b.payload) != null && v.page ? s = b.payload.page : (r = b.payload) != null && r.page_path && ((t = b.payload) != null && t.title) ? s = b.payload : (E = b.data) != null && E.page ? s = b.data.page : (o = b.data) != null && o.page_path && ((h = b.data) != null && h.title) && (s = b.data), s)
            if (s.action === "page_edited") {
              const d = N0(
                s.edit_timestamp || s.last_modified || s.created_timestamp || s.created_at || s.timestamp
              );
              F().updatePageContent(
                s.page_path,
                s.wiki_content || s.content || "",
                d,
                s.version
              );
            } else {
              const d = N0(
                s.created_timestamp || s.created_at || s.timestamp
              ), c = N0(
                s.last_modified || s.created_timestamp || s.created_at || s.timestamp
              ), y = {
                page_path: s.page_path,
                title: s.title,
                wiki_content: s.wiki_content || s.content || "(Content not available in notification)",
                creator_id: s.created_by || s.creator_id || s.owner_id || s.edited_by || "unknown",
                created_at: d,
                last_modified: c,
                version: s.version || 1
              };
              F().updateOrAddPageToList(y);
            }
        }
      };
      x && x.onWikiEvent ? x.onWikiEvent(a) : window.__WIKI_EVENT_HANDLERS__ ? window.__WIKI_EVENT_HANDLERS__.push(a) : window.__WIKI_EVENT_HANDLERS__ = [a], m({ eventHandler: a });
    },
    cleanupEventListeners: () => {
      const { eventHandler: e } = F();
      if (console.log("WikiStore: Cleaning up wiki event listeners"), e) {
        const x = window.__EVENT_ROUTER__;
        if (x && x.offWikiEvent)
          x.offWikiEvent(e);
        else if (window.__WIKI_EVENT_HANDLERS__) {
          const a = window.__WIKI_EVENT_HANDLERS__, b = a.indexOf(e);
          b > -1 && a.splice(b, 1);
        }
        m({ eventHandler: null });
      }
    }
  };
});
function pt(m, F) {
  let i;
  try {
    i = m();
  } catch {
    return;
  }
  return {
    getItem: (x) => {
      var a;
      const b = (v) => v === null ? null : JSON.parse(v, F == null ? void 0 : F.reviver), u = (a = i.getItem(x)) != null ? a : null;
      return u instanceof Promise ? u.then(b) : b(u);
    },
    setItem: (x, a) => i.setItem(
      x,
      JSON.stringify(a, F == null ? void 0 : F.replacer)
    ),
    removeItem: (x) => i.removeItem(x)
  };
}
const V0 = (m) => (F) => {
  try {
    const i = m(F);
    return i instanceof Promise ? i : {
      then(e) {
        return V0(e)(i);
      },
      catch(e) {
        return this;
      }
    };
  } catch (i) {
    return {
      then(e) {
        return this;
      },
      catch(e) {
        return V0(e)(i);
      }
    };
  }
}, gt = (m, F) => (i, e, x) => {
  let a = {
    getStorage: () => localStorage,
    serialize: JSON.stringify,
    deserialize: JSON.parse,
    partialize: (c) => c,
    version: 0,
    merge: (c, y) => ({
      ...y,
      ...c
    }),
    ...F
  }, b = !1;
  const u = /* @__PURE__ */ new Set(), v = /* @__PURE__ */ new Set();
  let r;
  try {
    r = a.getStorage();
  } catch {
  }
  if (!r)
    return m(
      (...c) => {
        console.warn(
          `[zustand persist middleware] Unable to update item '${a.name}', the given storage is currently unavailable.`
        ), i(...c);
      },
      e,
      x
    );
  const t = V0(a.serialize), E = () => {
    const c = a.partialize({ ...e() });
    let y;
    const n = t({ state: c, version: a.version }).then(
      (l) => r.setItem(a.name, l)
    ).catch((l) => {
      y = l;
    });
    if (y)
      throw y;
    return n;
  }, o = x.setState;
  x.setState = (c, y) => {
    o(c, y), E();
  };
  const h = m(
    (...c) => {
      i(...c), E();
    },
    e,
    x
  );
  let s;
  const d = () => {
    var c;
    if (!r)
      return;
    b = !1, u.forEach((n) => n(e()));
    const y = ((c = a.onRehydrateStorage) == null ? void 0 : c.call(a, e())) || void 0;
    return V0(r.getItem.bind(r))(a.name).then((n) => {
      if (n)
        return a.deserialize(n);
    }).then((n) => {
      if (n)
        if (typeof n.version == "number" && n.version !== a.version) {
          if (a.migrate)
            return a.migrate(
              n.state,
              n.version
            );
          console.error(
            "State loaded from storage couldn't be migrated since no migrate function was provided"
          );
        } else
          return n.state;
    }).then((n) => {
      var l;
      return s = a.merge(
        n,
        (l = e()) != null ? l : h
      ), i(s, !0), E();
    }).then(() => {
      y == null || y(s, void 0), b = !0, v.forEach((n) => n(s));
    }).catch((n) => {
      y == null || y(void 0, n);
    });
  };
  return x.persist = {
    setOptions: (c) => {
      a = {
        ...a,
        ...c
      }, c.getStorage && (r = c.getStorage());
    },
    clearStorage: () => {
      r == null || r.removeItem(a.name);
    },
    getOptions: () => a,
    rehydrate: () => d(),
    hasHydrated: () => b,
    onHydrate: (c) => (u.add(c), () => {
      u.delete(c);
    }),
    onFinishHydration: (c) => (v.add(c), () => {
      v.delete(c);
    })
  }, d(), s || h;
}, Et = (m, F) => (i, e, x) => {
  let a = {
    storage: pt(() => localStorage),
    partialize: (d) => d,
    version: 0,
    merge: (d, c) => ({
      ...c,
      ...d
    }),
    ...F
  }, b = !1;
  const u = /* @__PURE__ */ new Set(), v = /* @__PURE__ */ new Set();
  let r = a.storage;
  if (!r)
    return m(
      (...d) => {
        console.warn(
          `[zustand persist middleware] Unable to update item '${a.name}', the given storage is currently unavailable.`
        ), i(...d);
      },
      e,
      x
    );
  const t = () => {
    const d = a.partialize({ ...e() });
    return r.setItem(a.name, {
      state: d,
      version: a.version
    });
  }, E = x.setState;
  x.setState = (d, c) => {
    E(d, c), t();
  };
  const o = m(
    (...d) => {
      i(...d), t();
    },
    e,
    x
  );
  x.getInitialState = () => o;
  let h;
  const s = () => {
    var d, c;
    if (!r)
      return;
    b = !1, u.forEach((n) => {
      var l;
      return n((l = e()) != null ? l : o);
    });
    const y = ((c = a.onRehydrateStorage) == null ? void 0 : c.call(a, (d = e()) != null ? d : o)) || void 0;
    return V0(r.getItem.bind(r))(a.name).then((n) => {
      if (n)
        if (typeof n.version == "number" && n.version !== a.version) {
          if (a.migrate)
            return [
              !0,
              a.migrate(
                n.state,
                n.version
              )
            ];
          console.error(
            "State loaded from storage couldn't be migrated since no migrate function was provided"
          );
        } else
          return [!1, n.state];
      return [!1, void 0];
    }).then((n) => {
      var l;
      const [f, C] = n;
      if (h = a.merge(
        C,
        (l = e()) != null ? l : o
      ), i(h, !0), f)
        return t();
    }).then(() => {
      y == null || y(h, void 0), h = e(), b = !0, v.forEach((n) => n(h));
    }).catch((n) => {
      y == null || y(void 0, n);
    });
  };
  return x.persist = {
    setOptions: (d) => {
      a = {
        ...a,
        ...d
      }, d.storage && (r = d.storage);
    },
    clearStorage: () => {
      r == null || r.removeItem(a.name);
    },
    getOptions: () => a,
    rehydrate: () => s(),
    hasHydrated: () => b,
    onHydrate: (d) => (u.add(d), () => {
      u.delete(d);
    }),
    onFinishHydration: (d) => (v.add(d), () => {
      v.delete(d);
    })
  }, a.skipHydration || s(), h || o;
}, mt = (m, F) => "getStorage" in F || "serialize" in F || "deserialize" in F ? gt(m, F) : Et(m, F), tr = mt, yt = 10, Ct = oe()(
  tr(
    (m, F) => ({
      recentPages: [],
      addRecentPage: (i) => {
        var a;
        const e = Date.now(), x = {
          page_path: i.page_path,
          title: i.title,
          visited_at: e,
          preview_content: ((a = i.wiki_content) == null ? void 0 : a.substring(0, 100)) || ""
        };
        m((b) => {
          const u = b.recentPages.filter(
            (r) => r.page_path !== i.page_path
          );
          return {
            recentPages: [x, ...u].slice(0, yt)
          };
        });
      },
      clearRecentPages: () => {
        m({ recentPages: [] });
      },
      removeRecentPage: (i) => {
        m((e) => ({
          recentPages: e.recentPages.filter(
            (x) => x.page_path !== i
          )
        }));
      }
    }),
    {
      name: "wiki-recent-pages-storage"
    }
  )
);
var $r = { exports: {} };
function bt(m) {
  throw new Error('Could not dynamically require "' + m + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var Ee = { exports: {} };
const Bt = {}, _t = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Bt
}, Symbol.toStringTag, { value: "Module" })), At = /* @__PURE__ */ ut(_t);
var cr;
function U() {
  return cr || (cr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e();
    })(M, function() {
      var i = i || function(e, x) {
        var a;
        if (typeof window < "u" && window.crypto && (a = window.crypto), typeof self < "u" && self.crypto && (a = self.crypto), typeof globalThis < "u" && globalThis.crypto && (a = globalThis.crypto), !a && typeof window < "u" && window.msCrypto && (a = window.msCrypto), !a && typeof M < "u" && M.crypto && (a = M.crypto), !a && typeof bt == "function")
          try {
            a = At;
          } catch {
          }
        var b = function() {
          if (a) {
            if (typeof a.getRandomValues == "function")
              try {
                return a.getRandomValues(new Uint32Array(1))[0];
              } catch {
              }
            if (typeof a.randomBytes == "function")
              try {
                return a.randomBytes(4).readInt32LE();
              } catch {
              }
          }
          throw new Error("Native crypto module could not be used to get secure random number.");
        }, u = Object.create || function() {
          function n() {
          }
          return function(l) {
            var f;
            return n.prototype = l, f = new n(), n.prototype = null, f;
          };
        }(), v = {}, r = v.lib = {}, t = r.Base = function() {
          return {
            /**
             * Creates a new object that inherits from this object.
             *
             * @param {Object} overrides Properties to copy into the new object.
             *
             * @return {Object} The new object.
             *
             * @static
             *
             * @example
             *
             *     var MyType = CryptoJS.lib.Base.extend({
             *         field: 'value',
             *
             *         method: function () {
             *         }
             *     });
             */
            extend: function(n) {
              var l = u(this);
              return n && l.mixIn(n), (!l.hasOwnProperty("init") || this.init === l.init) && (l.init = function() {
                l.$super.init.apply(this, arguments);
              }), l.init.prototype = l, l.$super = this, l;
            },
            /**
             * Extends this object and runs the init method.
             * Arguments to create() will be passed to init().
             *
             * @return {Object} The new object.
             *
             * @static
             *
             * @example
             *
             *     var instance = MyType.create();
             */
            create: function() {
              var n = this.extend();
              return n.init.apply(n, arguments), n;
            },
            /**
             * Initializes a newly created object.
             * Override this method to add some logic when your objects are created.
             *
             * @example
             *
             *     var MyType = CryptoJS.lib.Base.extend({
             *         init: function () {
             *             // ...
             *         }
             *     });
             */
            init: function() {
            },
            /**
             * Copies properties into this object.
             *
             * @param {Object} properties The properties to mix in.
             *
             * @example
             *
             *     MyType.mixIn({
             *         field: 'value'
             *     });
             */
            mixIn: function(n) {
              for (var l in n)
                n.hasOwnProperty(l) && (this[l] = n[l]);
              n.hasOwnProperty("toString") && (this.toString = n.toString);
            },
            /**
             * Creates a copy of this object.
             *
             * @return {Object} The clone.
             *
             * @example
             *
             *     var clone = instance.clone();
             */
            clone: function() {
              return this.init.prototype.extend(this);
            }
          };
        }(), E = r.WordArray = t.extend({
          /**
           * Initializes a newly created word array.
           *
           * @param {Array} words (Optional) An array of 32-bit words.
           * @param {number} sigBytes (Optional) The number of significant bytes in the words.
           *
           * @example
           *
           *     var wordArray = CryptoJS.lib.WordArray.create();
           *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
           *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
           */
          init: function(n, l) {
            n = this.words = n || [], l != x ? this.sigBytes = l : this.sigBytes = n.length * 4;
          },
          /**
           * Converts this word array to a string.
           *
           * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
           *
           * @return {string} The stringified word array.
           *
           * @example
           *
           *     var string = wordArray + '';
           *     var string = wordArray.toString();
           *     var string = wordArray.toString(CryptoJS.enc.Utf8);
           */
          toString: function(n) {
            return (n || h).stringify(this);
          },
          /**
           * Concatenates a word array to this word array.
           *
           * @param {WordArray} wordArray The word array to append.
           *
           * @return {WordArray} This word array.
           *
           * @example
           *
           *     wordArray1.concat(wordArray2);
           */
          concat: function(n) {
            var l = this.words, f = n.words, C = this.sigBytes, _ = n.sigBytes;
            if (this.clamp(), C % 4)
              for (var A = 0; A < _; A++) {
                var D = f[A >>> 2] >>> 24 - A % 4 * 8 & 255;
                l[C + A >>> 2] |= D << 24 - (C + A) % 4 * 8;
              }
            else
              for (var W = 0; W < _; W += 4)
                l[C + W >>> 2] = f[W >>> 2];
            return this.sigBytes += _, this;
          },
          /**
           * Removes insignificant bits.
           *
           * @example
           *
           *     wordArray.clamp();
           */
          clamp: function() {
            var n = this.words, l = this.sigBytes;
            n[l >>> 2] &= 4294967295 << 32 - l % 4 * 8, n.length = e.ceil(l / 4);
          },
          /**
           * Creates a copy of this word array.
           *
           * @return {WordArray} The clone.
           *
           * @example
           *
           *     var clone = wordArray.clone();
           */
          clone: function() {
            var n = t.clone.call(this);
            return n.words = this.words.slice(0), n;
          },
          /**
           * Creates a word array filled with random bytes.
           *
           * @param {number} nBytes The number of random bytes to generate.
           *
           * @return {WordArray} The random word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.lib.WordArray.random(16);
           */
          random: function(n) {
            for (var l = [], f = 0; f < n; f += 4)
              l.push(b());
            return new E.init(l, n);
          }
        }), o = v.enc = {}, h = o.Hex = {
          /**
           * Converts a word array to a hex string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The hex string.
           *
           * @static
           *
           * @example
           *
           *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
           */
          stringify: function(n) {
            for (var l = n.words, f = n.sigBytes, C = [], _ = 0; _ < f; _++) {
              var A = l[_ >>> 2] >>> 24 - _ % 4 * 8 & 255;
              C.push((A >>> 4).toString(16)), C.push((A & 15).toString(16));
            }
            return C.join("");
          },
          /**
           * Converts a hex string to a word array.
           *
           * @param {string} hexStr The hex string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
           */
          parse: function(n) {
            for (var l = n.length, f = [], C = 0; C < l; C += 2)
              f[C >>> 3] |= parseInt(n.substr(C, 2), 16) << 24 - C % 8 * 4;
            return new E.init(f, l / 2);
          }
        }, s = o.Latin1 = {
          /**
           * Converts a word array to a Latin1 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The Latin1 string.
           *
           * @static
           *
           * @example
           *
           *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
           */
          stringify: function(n) {
            for (var l = n.words, f = n.sigBytes, C = [], _ = 0; _ < f; _++) {
              var A = l[_ >>> 2] >>> 24 - _ % 4 * 8 & 255;
              C.push(String.fromCharCode(A));
            }
            return C.join("");
          },
          /**
           * Converts a Latin1 string to a word array.
           *
           * @param {string} latin1Str The Latin1 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
           */
          parse: function(n) {
            for (var l = n.length, f = [], C = 0; C < l; C++)
              f[C >>> 2] |= (n.charCodeAt(C) & 255) << 24 - C % 4 * 8;
            return new E.init(f, l);
          }
        }, d = o.Utf8 = {
          /**
           * Converts a word array to a UTF-8 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-8 string.
           *
           * @static
           *
           * @example
           *
           *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
           */
          stringify: function(n) {
            try {
              return decodeURIComponent(escape(s.stringify(n)));
            } catch {
              throw new Error("Malformed UTF-8 data");
            }
          },
          /**
           * Converts a UTF-8 string to a word array.
           *
           * @param {string} utf8Str The UTF-8 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
           */
          parse: function(n) {
            return s.parse(unescape(encodeURIComponent(n)));
          }
        }, c = r.BufferedBlockAlgorithm = t.extend({
          /**
           * Resets this block algorithm's data buffer to its initial state.
           *
           * @example
           *
           *     bufferedBlockAlgorithm.reset();
           */
          reset: function() {
            this._data = new E.init(), this._nDataBytes = 0;
          },
          /**
           * Adds new data to this block algorithm's buffer.
           *
           * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
           *
           * @example
           *
           *     bufferedBlockAlgorithm._append('data');
           *     bufferedBlockAlgorithm._append(wordArray);
           */
          _append: function(n) {
            typeof n == "string" && (n = d.parse(n)), this._data.concat(n), this._nDataBytes += n.sigBytes;
          },
          /**
           * Processes available data blocks.
           *
           * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
           *
           * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
           *
           * @return {WordArray} The processed data.
           *
           * @example
           *
           *     var processedData = bufferedBlockAlgorithm._process();
           *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
           */
          _process: function(n) {
            var l, f = this._data, C = f.words, _ = f.sigBytes, A = this.blockSize, D = A * 4, W = _ / D;
            n ? W = e.ceil(W) : W = e.max((W | 0) - this._minBufferSize, 0);
            var B = W * A, k = e.min(B * 4, _);
            if (B) {
              for (var S = 0; S < B; S += A)
                this._doProcessBlock(C, S);
              l = C.splice(0, B), f.sigBytes -= k;
            }
            return new E.init(l, k);
          },
          /**
           * Creates a copy of this object.
           *
           * @return {Object} The clone.
           *
           * @example
           *
           *     var clone = bufferedBlockAlgorithm.clone();
           */
          clone: function() {
            var n = t.clone.call(this);
            return n._data = this._data.clone(), n;
          },
          _minBufferSize: 0
        });
        r.Hasher = c.extend({
          /**
           * Configuration options.
           */
          cfg: t.extend(),
          /**
           * Initializes a newly created hasher.
           *
           * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
           *
           * @example
           *
           *     var hasher = CryptoJS.algo.SHA256.create();
           */
          init: function(n) {
            this.cfg = this.cfg.extend(n), this.reset();
          },
          /**
           * Resets this hasher to its initial state.
           *
           * @example
           *
           *     hasher.reset();
           */
          reset: function() {
            c.reset.call(this), this._doReset();
          },
          /**
           * Updates this hasher with a message.
           *
           * @param {WordArray|string} messageUpdate The message to append.
           *
           * @return {Hasher} This hasher.
           *
           * @example
           *
           *     hasher.update('message');
           *     hasher.update(wordArray);
           */
          update: function(n) {
            return this._append(n), this._process(), this;
          },
          /**
           * Finalizes the hash computation.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} messageUpdate (Optional) A final message update.
           *
           * @return {WordArray} The hash.
           *
           * @example
           *
           *     var hash = hasher.finalize();
           *     var hash = hasher.finalize('message');
           *     var hash = hasher.finalize(wordArray);
           */
          finalize: function(n) {
            n && this._append(n);
            var l = this._doFinalize();
            return l;
          },
          blockSize: 16,
          /**
           * Creates a shortcut function to a hasher's object interface.
           *
           * @param {Hasher} hasher The hasher to create a helper for.
           *
           * @return {Function} The shortcut function.
           *
           * @static
           *
           * @example
           *
           *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
           */
          _createHelper: function(n) {
            return function(l, f) {
              return new n.init(f).finalize(l);
            };
          },
          /**
           * Creates a shortcut function to the HMAC's object interface.
           *
           * @param {Hasher} hasher The hasher to use in this HMAC helper.
           *
           * @return {Function} The shortcut function.
           *
           * @static
           *
           * @example
           *
           *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
           */
          _createHmacHelper: function(n) {
            return function(l, f) {
              return new y.HMAC.init(n, f).finalize(l);
            };
          }
        });
        var y = v.algo = {};
        return v;
      }(Math);
      return i;
    });
  }(Ee)), Ee.exports;
}
var me = { exports: {} }, lr;
function se() {
  return lr || (lr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function(e) {
        var x = i, a = x.lib, b = a.Base, u = a.WordArray, v = x.x64 = {};
        v.Word = b.extend({
          /**
           * Initializes a newly created 64-bit word.
           *
           * @param {number} high The high 32 bits.
           * @param {number} low The low 32 bits.
           *
           * @example
           *
           *     var x64Word = CryptoJS.x64.Word.create(0x00010203, 0x04050607);
           */
          init: function(r, t) {
            this.high = r, this.low = t;
          }
          /**
           * Bitwise NOTs this word.
           *
           * @return {X64Word} A new x64-Word object after negating.
           *
           * @example
           *
           *     var negated = x64Word.not();
           */
          // not: function () {
          // var high = ~this.high;
          // var low = ~this.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Bitwise ANDs this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to AND with this word.
           *
           * @return {X64Word} A new x64-Word object after ANDing.
           *
           * @example
           *
           *     var anded = x64Word.and(anotherX64Word);
           */
          // and: function (word) {
          // var high = this.high & word.high;
          // var low = this.low & word.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Bitwise ORs this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to OR with this word.
           *
           * @return {X64Word} A new x64-Word object after ORing.
           *
           * @example
           *
           *     var ored = x64Word.or(anotherX64Word);
           */
          // or: function (word) {
          // var high = this.high | word.high;
          // var low = this.low | word.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Bitwise XORs this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to XOR with this word.
           *
           * @return {X64Word} A new x64-Word object after XORing.
           *
           * @example
           *
           *     var xored = x64Word.xor(anotherX64Word);
           */
          // xor: function (word) {
          // var high = this.high ^ word.high;
          // var low = this.low ^ word.low;
          // return X64Word.create(high, low);
          // },
          /**
           * Shifts this word n bits to the left.
           *
           * @param {number} n The number of bits to shift.
           *
           * @return {X64Word} A new x64-Word object after shifting.
           *
           * @example
           *
           *     var shifted = x64Word.shiftL(25);
           */
          // shiftL: function (n) {
          // if (n < 32) {
          // var high = (this.high << n) | (this.low >>> (32 - n));
          // var low = this.low << n;
          // } else {
          // var high = this.low << (n - 32);
          // var low = 0;
          // }
          // return X64Word.create(high, low);
          // },
          /**
           * Shifts this word n bits to the right.
           *
           * @param {number} n The number of bits to shift.
           *
           * @return {X64Word} A new x64-Word object after shifting.
           *
           * @example
           *
           *     var shifted = x64Word.shiftR(7);
           */
          // shiftR: function (n) {
          // if (n < 32) {
          // var low = (this.low >>> n) | (this.high << (32 - n));
          // var high = this.high >>> n;
          // } else {
          // var low = this.high >>> (n - 32);
          // var high = 0;
          // }
          // return X64Word.create(high, low);
          // },
          /**
           * Rotates this word n bits to the left.
           *
           * @param {number} n The number of bits to rotate.
           *
           * @return {X64Word} A new x64-Word object after rotating.
           *
           * @example
           *
           *     var rotated = x64Word.rotL(25);
           */
          // rotL: function (n) {
          // return this.shiftL(n).or(this.shiftR(64 - n));
          // },
          /**
           * Rotates this word n bits to the right.
           *
           * @param {number} n The number of bits to rotate.
           *
           * @return {X64Word} A new x64-Word object after rotating.
           *
           * @example
           *
           *     var rotated = x64Word.rotR(7);
           */
          // rotR: function (n) {
          // return this.shiftR(n).or(this.shiftL(64 - n));
          // },
          /**
           * Adds this word with the passed word.
           *
           * @param {X64Word} word The x64-Word to add with this word.
           *
           * @return {X64Word} A new x64-Word object after adding.
           *
           * @example
           *
           *     var added = x64Word.add(anotherX64Word);
           */
          // add: function (word) {
          // var low = (this.low + word.low) | 0;
          // var carry = (low >>> 0) < (this.low >>> 0) ? 1 : 0;
          // var high = (this.high + word.high + carry) | 0;
          // return X64Word.create(high, low);
          // }
        }), v.WordArray = b.extend({
          /**
           * Initializes a newly created word array.
           *
           * @param {Array} words (Optional) An array of CryptoJS.x64.Word objects.
           * @param {number} sigBytes (Optional) The number of significant bytes in the words.
           *
           * @example
           *
           *     var wordArray = CryptoJS.x64.WordArray.create();
           *
           *     var wordArray = CryptoJS.x64.WordArray.create([
           *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
           *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
           *     ]);
           *
           *     var wordArray = CryptoJS.x64.WordArray.create([
           *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
           *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
           *     ], 10);
           */
          init: function(r, t) {
            r = this.words = r || [], t != e ? this.sigBytes = t : this.sigBytes = r.length * 8;
          },
          /**
           * Converts this 64-bit word array to a 32-bit word array.
           *
           * @return {CryptoJS.lib.WordArray} This word array's data as a 32-bit word array.
           *
           * @example
           *
           *     var x32WordArray = x64WordArray.toX32();
           */
          toX32: function() {
            for (var r = this.words, t = r.length, E = [], o = 0; o < t; o++) {
              var h = r[o];
              E.push(h.high), E.push(h.low);
            }
            return u.create(E, this.sigBytes);
          },
          /**
           * Creates a copy of this word array.
           *
           * @return {X64WordArray} The clone.
           *
           * @example
           *
           *     var clone = x64WordArray.clone();
           */
          clone: function() {
            for (var r = b.clone.call(this), t = r.words = this.words.slice(0), E = t.length, o = 0; o < E; o++)
              t[o] = t[o].clone();
            return r;
          }
        });
      }(), i;
    });
  }(me)), me.exports;
}
var ye = { exports: {} }, dr;
function Ft() {
  return dr || (dr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function() {
        if (typeof ArrayBuffer == "function") {
          var e = i, x = e.lib, a = x.WordArray, b = a.init, u = a.init = function(v) {
            if (v instanceof ArrayBuffer && (v = new Uint8Array(v)), (v instanceof Int8Array || typeof Uint8ClampedArray < "u" && v instanceof Uint8ClampedArray || v instanceof Int16Array || v instanceof Uint16Array || v instanceof Int32Array || v instanceof Uint32Array || v instanceof Float32Array || v instanceof Float64Array) && (v = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)), v instanceof Uint8Array) {
              for (var r = v.byteLength, t = [], E = 0; E < r; E++)
                t[E >>> 2] |= v[E] << 24 - E % 4 * 8;
              b.call(this, t, r);
            } else
              b.apply(this, arguments);
          };
          u.prototype = a;
        }
      }(), i.lib.WordArray;
    });
  }(ye)), ye.exports;
}
var Ce = { exports: {} }, fr;
function kt() {
  return fr || (fr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.WordArray, b = e.enc;
        b.Utf16 = b.Utf16BE = {
          /**
           * Converts a word array to a UTF-16 BE string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-16 BE string.
           *
           * @static
           *
           * @example
           *
           *     var utf16String = CryptoJS.enc.Utf16.stringify(wordArray);
           */
          stringify: function(v) {
            for (var r = v.words, t = v.sigBytes, E = [], o = 0; o < t; o += 2) {
              var h = r[o >>> 2] >>> 16 - o % 4 * 8 & 65535;
              E.push(String.fromCharCode(h));
            }
            return E.join("");
          },
          /**
           * Converts a UTF-16 BE string to a word array.
           *
           * @param {string} utf16Str The UTF-16 BE string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf16.parse(utf16String);
           */
          parse: function(v) {
            for (var r = v.length, t = [], E = 0; E < r; E++)
              t[E >>> 1] |= v.charCodeAt(E) << 16 - E % 2 * 16;
            return a.create(t, r * 2);
          }
        }, b.Utf16LE = {
          /**
           * Converts a word array to a UTF-16 LE string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The UTF-16 LE string.
           *
           * @static
           *
           * @example
           *
           *     var utf16Str = CryptoJS.enc.Utf16LE.stringify(wordArray);
           */
          stringify: function(v) {
            for (var r = v.words, t = v.sigBytes, E = [], o = 0; o < t; o += 2) {
              var h = u(r[o >>> 2] >>> 16 - o % 4 * 8 & 65535);
              E.push(String.fromCharCode(h));
            }
            return E.join("");
          },
          /**
           * Converts a UTF-16 LE string to a word array.
           *
           * @param {string} utf16Str The UTF-16 LE string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Utf16LE.parse(utf16Str);
           */
          parse: function(v) {
            for (var r = v.length, t = [], E = 0; E < r; E++)
              t[E >>> 1] |= u(v.charCodeAt(E) << 16 - E % 2 * 16);
            return a.create(t, r * 2);
          }
        };
        function u(v) {
          return v << 8 & 4278255360 | v >>> 8 & 16711935;
        }
      }(), i.enc.Utf16;
    });
  }(Ce)), Ce.exports;
}
var be = { exports: {} }, ur;
function P0() {
  return ur || (ur = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.WordArray, b = e.enc;
        b.Base64 = {
          /**
           * Converts a word array to a Base64 string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @return {string} The Base64 string.
           *
           * @static
           *
           * @example
           *
           *     var base64String = CryptoJS.enc.Base64.stringify(wordArray);
           */
          stringify: function(v) {
            var r = v.words, t = v.sigBytes, E = this._map;
            v.clamp();
            for (var o = [], h = 0; h < t; h += 3)
              for (var s = r[h >>> 2] >>> 24 - h % 4 * 8 & 255, d = r[h + 1 >>> 2] >>> 24 - (h + 1) % 4 * 8 & 255, c = r[h + 2 >>> 2] >>> 24 - (h + 2) % 4 * 8 & 255, y = s << 16 | d << 8 | c, n = 0; n < 4 && h + n * 0.75 < t; n++)
                o.push(E.charAt(y >>> 6 * (3 - n) & 63));
            var l = E.charAt(64);
            if (l)
              for (; o.length % 4; )
                o.push(l);
            return o.join("");
          },
          /**
           * Converts a Base64 string to a word array.
           *
           * @param {string} base64Str The Base64 string.
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Base64.parse(base64String);
           */
          parse: function(v) {
            var r = v.length, t = this._map, E = this._reverseMap;
            if (!E) {
              E = this._reverseMap = [];
              for (var o = 0; o < t.length; o++)
                E[t.charCodeAt(o)] = o;
            }
            var h = t.charAt(64);
            if (h) {
              var s = v.indexOf(h);
              s !== -1 && (r = s);
            }
            return u(v, r, E);
          },
          _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
        };
        function u(v, r, t) {
          for (var E = [], o = 0, h = 0; h < r; h++)
            if (h % 4) {
              var s = t[v.charCodeAt(h - 1)] << h % 4 * 2, d = t[v.charCodeAt(h)] >>> 6 - h % 4 * 2, c = s | d;
              E[o >>> 2] |= c << 24 - o % 4 * 8, o++;
            }
          return a.create(E, o);
        }
      }(), i.enc.Base64;
    });
  }(be)), be.exports;
}
var Be = { exports: {} }, vr;
function Dt() {
  return vr || (vr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.WordArray, b = e.enc;
        b.Base64url = {
          /**
           * Converts a word array to a Base64url string.
           *
           * @param {WordArray} wordArray The word array.
           *
           * @param {boolean} urlSafe Whether to use url safe
           *
           * @return {string} The Base64url string.
           *
           * @static
           *
           * @example
           *
           *     var base64String = CryptoJS.enc.Base64url.stringify(wordArray);
           */
          stringify: function(v, r) {
            r === void 0 && (r = !0);
            var t = v.words, E = v.sigBytes, o = r ? this._safe_map : this._map;
            v.clamp();
            for (var h = [], s = 0; s < E; s += 3)
              for (var d = t[s >>> 2] >>> 24 - s % 4 * 8 & 255, c = t[s + 1 >>> 2] >>> 24 - (s + 1) % 4 * 8 & 255, y = t[s + 2 >>> 2] >>> 24 - (s + 2) % 4 * 8 & 255, n = d << 16 | c << 8 | y, l = 0; l < 4 && s + l * 0.75 < E; l++)
                h.push(o.charAt(n >>> 6 * (3 - l) & 63));
            var f = o.charAt(64);
            if (f)
              for (; h.length % 4; )
                h.push(f);
            return h.join("");
          },
          /**
           * Converts a Base64url string to a word array.
           *
           * @param {string} base64Str The Base64url string.
           *
           * @param {boolean} urlSafe Whether to use url safe
           *
           * @return {WordArray} The word array.
           *
           * @static
           *
           * @example
           *
           *     var wordArray = CryptoJS.enc.Base64url.parse(base64String);
           */
          parse: function(v, r) {
            r === void 0 && (r = !0);
            var t = v.length, E = r ? this._safe_map : this._map, o = this._reverseMap;
            if (!o) {
              o = this._reverseMap = [];
              for (var h = 0; h < E.length; h++)
                o[E.charCodeAt(h)] = h;
            }
            var s = E.charAt(64);
            if (s) {
              var d = v.indexOf(s);
              d !== -1 && (t = d);
            }
            return u(v, t, o);
          },
          _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
          _safe_map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        };
        function u(v, r, t) {
          for (var E = [], o = 0, h = 0; h < r; h++)
            if (h % 4) {
              var s = t[v.charCodeAt(h - 1)] << h % 4 * 2, d = t[v.charCodeAt(h)] >>> 6 - h % 4 * 2, c = s | d;
              E[o >>> 2] |= c << 24 - o % 4 * 8, o++;
            }
          return a.create(E, o);
        }
      }(), i.enc.Base64url;
    });
  }(Be)), Be.exports;
}
var _e = { exports: {} }, hr;
function H0() {
  return hr || (hr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function(e) {
        var x = i, a = x.lib, b = a.WordArray, u = a.Hasher, v = x.algo, r = [];
        (function() {
          for (var d = 0; d < 64; d++)
            r[d] = e.abs(e.sin(d + 1)) * 4294967296 | 0;
        })();
        var t = v.MD5 = u.extend({
          _doReset: function() {
            this._hash = new b.init([
              1732584193,
              4023233417,
              2562383102,
              271733878
            ]);
          },
          _doProcessBlock: function(d, c) {
            for (var y = 0; y < 16; y++) {
              var n = c + y, l = d[n];
              d[n] = (l << 8 | l >>> 24) & 16711935 | (l << 24 | l >>> 8) & 4278255360;
            }
            var f = this._hash.words, C = d[c + 0], _ = d[c + 1], A = d[c + 2], D = d[c + 3], W = d[c + 4], B = d[c + 5], k = d[c + 6], S = d[c + 7], w = d[c + 8], z = d[c + 9], L = d[c + 10], q = d[c + 11], Q = d[c + 12], X = d[c + 13], Z = d[c + 14], Y = d[c + 15], R = f[0], N = f[1], H = f[2], j = f[3];
            R = E(R, N, H, j, C, 7, r[0]), j = E(j, R, N, H, _, 12, r[1]), H = E(H, j, R, N, A, 17, r[2]), N = E(N, H, j, R, D, 22, r[3]), R = E(R, N, H, j, W, 7, r[4]), j = E(j, R, N, H, B, 12, r[5]), H = E(H, j, R, N, k, 17, r[6]), N = E(N, H, j, R, S, 22, r[7]), R = E(R, N, H, j, w, 7, r[8]), j = E(j, R, N, H, z, 12, r[9]), H = E(H, j, R, N, L, 17, r[10]), N = E(N, H, j, R, q, 22, r[11]), R = E(R, N, H, j, Q, 7, r[12]), j = E(j, R, N, H, X, 12, r[13]), H = E(H, j, R, N, Z, 17, r[14]), N = E(N, H, j, R, Y, 22, r[15]), R = o(R, N, H, j, _, 5, r[16]), j = o(j, R, N, H, k, 9, r[17]), H = o(H, j, R, N, q, 14, r[18]), N = o(N, H, j, R, C, 20, r[19]), R = o(R, N, H, j, B, 5, r[20]), j = o(j, R, N, H, L, 9, r[21]), H = o(H, j, R, N, Y, 14, r[22]), N = o(N, H, j, R, W, 20, r[23]), R = o(R, N, H, j, z, 5, r[24]), j = o(j, R, N, H, Z, 9, r[25]), H = o(H, j, R, N, D, 14, r[26]), N = o(N, H, j, R, w, 20, r[27]), R = o(R, N, H, j, X, 5, r[28]), j = o(j, R, N, H, A, 9, r[29]), H = o(H, j, R, N, S, 14, r[30]), N = o(N, H, j, R, Q, 20, r[31]), R = h(R, N, H, j, B, 4, r[32]), j = h(j, R, N, H, w, 11, r[33]), H = h(H, j, R, N, q, 16, r[34]), N = h(N, H, j, R, Z, 23, r[35]), R = h(R, N, H, j, _, 4, r[36]), j = h(j, R, N, H, W, 11, r[37]), H = h(H, j, R, N, S, 16, r[38]), N = h(N, H, j, R, L, 23, r[39]), R = h(R, N, H, j, X, 4, r[40]), j = h(j, R, N, H, C, 11, r[41]), H = h(H, j, R, N, D, 16, r[42]), N = h(N, H, j, R, k, 23, r[43]), R = h(R, N, H, j, z, 4, r[44]), j = h(j, R, N, H, Q, 11, r[45]), H = h(H, j, R, N, Y, 16, r[46]), N = h(N, H, j, R, A, 23, r[47]), R = s(R, N, H, j, C, 6, r[48]), j = s(j, R, N, H, S, 10, r[49]), H = s(H, j, R, N, Z, 15, r[50]), N = s(N, H, j, R, B, 21, r[51]), R = s(R, N, H, j, Q, 6, r[52]), j = s(j, R, N, H, D, 10, r[53]), H = s(H, j, R, N, L, 15, r[54]), N = s(N, H, j, R, _, 21, r[55]), R = s(R, N, H, j, w, 6, r[56]), j = s(j, R, N, H, Y, 10, r[57]), H = s(H, j, R, N, k, 15, r[58]), N = s(N, H, j, R, X, 21, r[59]), R = s(R, N, H, j, W, 6, r[60]), j = s(j, R, N, H, q, 10, r[61]), H = s(H, j, R, N, A, 15, r[62]), N = s(N, H, j, R, z, 21, r[63]), f[0] = f[0] + R | 0, f[1] = f[1] + N | 0, f[2] = f[2] + H | 0, f[3] = f[3] + j | 0;
          },
          _doFinalize: function() {
            var d = this._data, c = d.words, y = this._nDataBytes * 8, n = d.sigBytes * 8;
            c[n >>> 5] |= 128 << 24 - n % 32;
            var l = e.floor(y / 4294967296), f = y;
            c[(n + 64 >>> 9 << 4) + 15] = (l << 8 | l >>> 24) & 16711935 | (l << 24 | l >>> 8) & 4278255360, c[(n + 64 >>> 9 << 4) + 14] = (f << 8 | f >>> 24) & 16711935 | (f << 24 | f >>> 8) & 4278255360, d.sigBytes = (c.length + 1) * 4, this._process();
            for (var C = this._hash, _ = C.words, A = 0; A < 4; A++) {
              var D = _[A];
              _[A] = (D << 8 | D >>> 24) & 16711935 | (D << 24 | D >>> 8) & 4278255360;
            }
            return C;
          },
          clone: function() {
            var d = u.clone.call(this);
            return d._hash = this._hash.clone(), d;
          }
        });
        function E(d, c, y, n, l, f, C) {
          var _ = d + (c & y | ~c & n) + l + C;
          return (_ << f | _ >>> 32 - f) + c;
        }
        function o(d, c, y, n, l, f, C) {
          var _ = d + (c & n | y & ~n) + l + C;
          return (_ << f | _ >>> 32 - f) + c;
        }
        function h(d, c, y, n, l, f, C) {
          var _ = d + (c ^ y ^ n) + l + C;
          return (_ << f | _ >>> 32 - f) + c;
        }
        function s(d, c, y, n, l, f, C) {
          var _ = d + (y ^ (c | ~n)) + l + C;
          return (_ << f | _ >>> 32 - f) + c;
        }
        x.MD5 = u._createHelper(t), x.HmacMD5 = u._createHmacHelper(t);
      }(Math), i.MD5;
    });
  }(_e)), _e.exports;
}
var Ae = { exports: {} }, pr;
function Ur() {
  return pr || (pr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.WordArray, b = x.Hasher, u = e.algo, v = [], r = u.SHA1 = b.extend({
          _doReset: function() {
            this._hash = new a.init([
              1732584193,
              4023233417,
              2562383102,
              271733878,
              3285377520
            ]);
          },
          _doProcessBlock: function(t, E) {
            for (var o = this._hash.words, h = o[0], s = o[1], d = o[2], c = o[3], y = o[4], n = 0; n < 80; n++) {
              if (n < 16)
                v[n] = t[E + n] | 0;
              else {
                var l = v[n - 3] ^ v[n - 8] ^ v[n - 14] ^ v[n - 16];
                v[n] = l << 1 | l >>> 31;
              }
              var f = (h << 5 | h >>> 27) + y + v[n];
              n < 20 ? f += (s & d | ~s & c) + 1518500249 : n < 40 ? f += (s ^ d ^ c) + 1859775393 : n < 60 ? f += (s & d | s & c | d & c) - 1894007588 : f += (s ^ d ^ c) - 899497514, y = c, c = d, d = s << 30 | s >>> 2, s = h, h = f;
            }
            o[0] = o[0] + h | 0, o[1] = o[1] + s | 0, o[2] = o[2] + d | 0, o[3] = o[3] + c | 0, o[4] = o[4] + y | 0;
          },
          _doFinalize: function() {
            var t = this._data, E = t.words, o = this._nDataBytes * 8, h = t.sigBytes * 8;
            return E[h >>> 5] |= 128 << 24 - h % 32, E[(h + 64 >>> 9 << 4) + 14] = Math.floor(o / 4294967296), E[(h + 64 >>> 9 << 4) + 15] = o, t.sigBytes = E.length * 4, this._process(), this._hash;
          },
          clone: function() {
            var t = b.clone.call(this);
            return t._hash = this._hash.clone(), t;
          }
        });
        e.SHA1 = b._createHelper(r), e.HmacSHA1 = b._createHmacHelper(r);
      }(), i.SHA1;
    });
  }(Ae)), Ae.exports;
}
var Fe = { exports: {} }, gr;
function ar() {
  return gr || (gr = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      return function(e) {
        var x = i, a = x.lib, b = a.WordArray, u = a.Hasher, v = x.algo, r = [], t = [];
        (function() {
          function h(y) {
            for (var n = e.sqrt(y), l = 2; l <= n; l++)
              if (!(y % l))
                return !1;
            return !0;
          }
          function s(y) {
            return (y - (y | 0)) * 4294967296 | 0;
          }
          for (var d = 2, c = 0; c < 64; )
            h(d) && (c < 8 && (r[c] = s(e.pow(d, 1 / 2))), t[c] = s(e.pow(d, 1 / 3)), c++), d++;
        })();
        var E = [], o = v.SHA256 = u.extend({
          _doReset: function() {
            this._hash = new b.init(r.slice(0));
          },
          _doProcessBlock: function(h, s) {
            for (var d = this._hash.words, c = d[0], y = d[1], n = d[2], l = d[3], f = d[4], C = d[5], _ = d[6], A = d[7], D = 0; D < 64; D++) {
              if (D < 16)
                E[D] = h[s + D] | 0;
              else {
                var W = E[D - 15], B = (W << 25 | W >>> 7) ^ (W << 14 | W >>> 18) ^ W >>> 3, k = E[D - 2], S = (k << 15 | k >>> 17) ^ (k << 13 | k >>> 19) ^ k >>> 10;
                E[D] = B + E[D - 7] + S + E[D - 16];
              }
              var w = f & C ^ ~f & _, z = c & y ^ c & n ^ y & n, L = (c << 30 | c >>> 2) ^ (c << 19 | c >>> 13) ^ (c << 10 | c >>> 22), q = (f << 26 | f >>> 6) ^ (f << 21 | f >>> 11) ^ (f << 7 | f >>> 25), Q = A + q + w + t[D] + E[D], X = L + z;
              A = _, _ = C, C = f, f = l + Q | 0, l = n, n = y, y = c, c = Q + X | 0;
            }
            d[0] = d[0] + c | 0, d[1] = d[1] + y | 0, d[2] = d[2] + n | 0, d[3] = d[3] + l | 0, d[4] = d[4] + f | 0, d[5] = d[5] + C | 0, d[6] = d[6] + _ | 0, d[7] = d[7] + A | 0;
          },
          _doFinalize: function() {
            var h = this._data, s = h.words, d = this._nDataBytes * 8, c = h.sigBytes * 8;
            return s[c >>> 5] |= 128 << 24 - c % 32, s[(c + 64 >>> 9 << 4) + 14] = e.floor(d / 4294967296), s[(c + 64 >>> 9 << 4) + 15] = d, h.sigBytes = s.length * 4, this._process(), this._hash;
          },
          clone: function() {
            var h = u.clone.call(this);
            return h._hash = this._hash.clone(), h;
          }
        });
        x.SHA256 = u._createHelper(o), x.HmacSHA256 = u._createHmacHelper(o);
      }(Math), i.SHA256;
    });
  }(Fe)), Fe.exports;
}
var ke = { exports: {} }, Er;
function wt() {
  return Er || (Er = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), ar());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.WordArray, b = e.algo, u = b.SHA256, v = b.SHA224 = u.extend({
          _doReset: function() {
            this._hash = new a.init([
              3238371032,
              914150663,
              812702999,
              4144912697,
              4290775857,
              1750603025,
              1694076839,
              3204075428
            ]);
          },
          _doFinalize: function() {
            var r = u._doFinalize.call(this);
            return r.sigBytes -= 4, r;
          }
        });
        e.SHA224 = u._createHelper(v), e.HmacSHA224 = u._createHmacHelper(v);
      }(), i.SHA224;
    });
  }(ke)), ke.exports;
}
var De = { exports: {} }, mr;
function Kr() {
  return mr || (mr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), se());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.Hasher, b = e.x64, u = b.Word, v = b.WordArray, r = e.algo;
        function t() {
          return u.create.apply(u, arguments);
        }
        var E = [
          t(1116352408, 3609767458),
          t(1899447441, 602891725),
          t(3049323471, 3964484399),
          t(3921009573, 2173295548),
          t(961987163, 4081628472),
          t(1508970993, 3053834265),
          t(2453635748, 2937671579),
          t(2870763221, 3664609560),
          t(3624381080, 2734883394),
          t(310598401, 1164996542),
          t(607225278, 1323610764),
          t(1426881987, 3590304994),
          t(1925078388, 4068182383),
          t(2162078206, 991336113),
          t(2614888103, 633803317),
          t(3248222580, 3479774868),
          t(3835390401, 2666613458),
          t(4022224774, 944711139),
          t(264347078, 2341262773),
          t(604807628, 2007800933),
          t(770255983, 1495990901),
          t(1249150122, 1856431235),
          t(1555081692, 3175218132),
          t(1996064986, 2198950837),
          t(2554220882, 3999719339),
          t(2821834349, 766784016),
          t(2952996808, 2566594879),
          t(3210313671, 3203337956),
          t(3336571891, 1034457026),
          t(3584528711, 2466948901),
          t(113926993, 3758326383),
          t(338241895, 168717936),
          t(666307205, 1188179964),
          t(773529912, 1546045734),
          t(1294757372, 1522805485),
          t(1396182291, 2643833823),
          t(1695183700, 2343527390),
          t(1986661051, 1014477480),
          t(2177026350, 1206759142),
          t(2456956037, 344077627),
          t(2730485921, 1290863460),
          t(2820302411, 3158454273),
          t(3259730800, 3505952657),
          t(3345764771, 106217008),
          t(3516065817, 3606008344),
          t(3600352804, 1432725776),
          t(4094571909, 1467031594),
          t(275423344, 851169720),
          t(430227734, 3100823752),
          t(506948616, 1363258195),
          t(659060556, 3750685593),
          t(883997877, 3785050280),
          t(958139571, 3318307427),
          t(1322822218, 3812723403),
          t(1537002063, 2003034995),
          t(1747873779, 3602036899),
          t(1955562222, 1575990012),
          t(2024104815, 1125592928),
          t(2227730452, 2716904306),
          t(2361852424, 442776044),
          t(2428436474, 593698344),
          t(2756734187, 3733110249),
          t(3204031479, 2999351573),
          t(3329325298, 3815920427),
          t(3391569614, 3928383900),
          t(3515267271, 566280711),
          t(3940187606, 3454069534),
          t(4118630271, 4000239992),
          t(116418474, 1914138554),
          t(174292421, 2731055270),
          t(289380356, 3203993006),
          t(460393269, 320620315),
          t(685471733, 587496836),
          t(852142971, 1086792851),
          t(1017036298, 365543100),
          t(1126000580, 2618297676),
          t(1288033470, 3409855158),
          t(1501505948, 4234509866),
          t(1607167915, 987167468),
          t(1816402316, 1246189591)
        ], o = [];
        (function() {
          for (var s = 0; s < 80; s++)
            o[s] = t();
        })();
        var h = r.SHA512 = a.extend({
          _doReset: function() {
            this._hash = new v.init([
              new u.init(1779033703, 4089235720),
              new u.init(3144134277, 2227873595),
              new u.init(1013904242, 4271175723),
              new u.init(2773480762, 1595750129),
              new u.init(1359893119, 2917565137),
              new u.init(2600822924, 725511199),
              new u.init(528734635, 4215389547),
              new u.init(1541459225, 327033209)
            ]);
          },
          _doProcessBlock: function(s, d) {
            for (var c = this._hash.words, y = c[0], n = c[1], l = c[2], f = c[3], C = c[4], _ = c[5], A = c[6], D = c[7], W = y.high, B = y.low, k = n.high, S = n.low, w = l.high, z = l.low, L = f.high, q = f.low, Q = C.high, X = C.low, Z = _.high, Y = _.low, R = A.high, N = A.low, H = D.high, j = D.low, e0 = W, V = B, a0 = k, I = S, C0 = w, u0 = z, L0 = L, _0 = q, l0 = Q, s0 = X, b0 = Z, v0 = Y, w0 = R, A0 = N, F0 = H, R0 = j, d0 = 0; d0 < 80; d0++) {
              var o0, m0, W0 = o[d0];
              if (d0 < 16)
                m0 = W0.high = s[d + d0 * 2] | 0, o0 = W0.low = s[d + d0 * 2 + 1] | 0;
              else {
                var O0 = o[d0 - 15], B0 = O0.high, h0 = O0.low, xe = (B0 >>> 1 | h0 << 31) ^ (B0 >>> 8 | h0 << 24) ^ B0 >>> 7, I0 = (h0 >>> 1 | B0 << 31) ^ (h0 >>> 8 | B0 << 24) ^ (h0 >>> 7 | B0 << 25), q0 = o[d0 - 2], y0 = q0.high, S0 = q0.low, ce = (y0 >>> 19 | S0 << 13) ^ (y0 << 3 | S0 >>> 29) ^ y0 >>> 6, Q0 = (S0 >>> 19 | y0 << 13) ^ (S0 << 3 | y0 >>> 29) ^ (S0 >>> 6 | y0 << 26), J0 = o[d0 - 7], le = J0.high, de = J0.low, ee = o[d0 - 16], M0 = ee.high, $0 = ee.low;
                o0 = I0 + de, m0 = xe + le + (o0 >>> 0 < I0 >>> 0 ? 1 : 0), o0 = o0 + Q0, m0 = m0 + ce + (o0 >>> 0 < Q0 >>> 0 ? 1 : 0), o0 = o0 + $0, m0 = m0 + M0 + (o0 >>> 0 < $0 >>> 0 ? 1 : 0), W0.high = m0, W0.low = o0;
              }
              var k0 = l0 & b0 ^ ~l0 & w0, T0 = s0 & v0 ^ ~s0 & A0, U0 = e0 & a0 ^ e0 & C0 ^ a0 & C0, re = V & I ^ V & u0 ^ I & u0, fe = (e0 >>> 28 | V << 4) ^ (e0 << 30 | V >>> 2) ^ (e0 << 25 | V >>> 7), K0 = (V >>> 28 | e0 << 4) ^ (V << 30 | e0 >>> 2) ^ (V << 25 | e0 >>> 7), ue = (l0 >>> 14 | s0 << 18) ^ (l0 >>> 18 | s0 << 14) ^ (l0 << 23 | s0 >>> 9), te = (s0 >>> 14 | l0 << 18) ^ (s0 >>> 18 | l0 << 14) ^ (s0 << 23 | l0 >>> 9), X0 = E[d0], ve = X0.high, ae = X0.low, i0 = R0 + te, p0 = F0 + ue + (i0 >>> 0 < R0 >>> 0 ? 1 : 0), i0 = i0 + T0, p0 = p0 + k0 + (i0 >>> 0 < T0 >>> 0 ? 1 : 0), i0 = i0 + ae, p0 = p0 + ve + (i0 >>> 0 < ae >>> 0 ? 1 : 0), i0 = i0 + o0, p0 = p0 + m0 + (i0 >>> 0 < o0 >>> 0 ? 1 : 0), ne = K0 + re, he = fe + U0 + (ne >>> 0 < K0 >>> 0 ? 1 : 0);
              F0 = w0, R0 = A0, w0 = b0, A0 = v0, b0 = l0, v0 = s0, s0 = _0 + i0 | 0, l0 = L0 + p0 + (s0 >>> 0 < _0 >>> 0 ? 1 : 0) | 0, L0 = C0, _0 = u0, C0 = a0, u0 = I, a0 = e0, I = V, V = i0 + ne | 0, e0 = p0 + he + (V >>> 0 < i0 >>> 0 ? 1 : 0) | 0;
            }
            B = y.low = B + V, y.high = W + e0 + (B >>> 0 < V >>> 0 ? 1 : 0), S = n.low = S + I, n.high = k + a0 + (S >>> 0 < I >>> 0 ? 1 : 0), z = l.low = z + u0, l.high = w + C0 + (z >>> 0 < u0 >>> 0 ? 1 : 0), q = f.low = q + _0, f.high = L + L0 + (q >>> 0 < _0 >>> 0 ? 1 : 0), X = C.low = X + s0, C.high = Q + l0 + (X >>> 0 < s0 >>> 0 ? 1 : 0), Y = _.low = Y + v0, _.high = Z + b0 + (Y >>> 0 < v0 >>> 0 ? 1 : 0), N = A.low = N + A0, A.high = R + w0 + (N >>> 0 < A0 >>> 0 ? 1 : 0), j = D.low = j + R0, D.high = H + F0 + (j >>> 0 < R0 >>> 0 ? 1 : 0);
          },
          _doFinalize: function() {
            var s = this._data, d = s.words, c = this._nDataBytes * 8, y = s.sigBytes * 8;
            d[y >>> 5] |= 128 << 24 - y % 32, d[(y + 128 >>> 10 << 5) + 30] = Math.floor(c / 4294967296), d[(y + 128 >>> 10 << 5) + 31] = c, s.sigBytes = d.length * 4, this._process();
            var n = this._hash.toX32();
            return n;
          },
          clone: function() {
            var s = a.clone.call(this);
            return s._hash = this._hash.clone(), s;
          },
          blockSize: 1024 / 32
        });
        e.SHA512 = a._createHelper(h), e.HmacSHA512 = a._createHmacHelper(h);
      }(), i.SHA512;
    });
  }(De)), De.exports;
}
var we = { exports: {} }, yr;
function Rt() {
  return yr || (yr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), se(), Kr());
    })(M, function(i) {
      return function() {
        var e = i, x = e.x64, a = x.Word, b = x.WordArray, u = e.algo, v = u.SHA512, r = u.SHA384 = v.extend({
          _doReset: function() {
            this._hash = new b.init([
              new a.init(3418070365, 3238371032),
              new a.init(1654270250, 914150663),
              new a.init(2438529370, 812702999),
              new a.init(355462360, 4144912697),
              new a.init(1731405415, 4290775857),
              new a.init(2394180231, 1750603025),
              new a.init(3675008525, 1694076839),
              new a.init(1203062813, 3204075428)
            ]);
          },
          _doFinalize: function() {
            var t = v._doFinalize.call(this);
            return t.sigBytes -= 16, t;
          }
        });
        e.SHA384 = v._createHelper(r), e.HmacSHA384 = v._createHmacHelper(r);
      }(), i.SHA384;
    });
  }(we)), we.exports;
}
var Re = { exports: {} }, Cr;
function St() {
  return Cr || (Cr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), se());
    })(M, function(i) {
      return function(e) {
        var x = i, a = x.lib, b = a.WordArray, u = a.Hasher, v = x.x64, r = v.Word, t = x.algo, E = [], o = [], h = [];
        (function() {
          for (var c = 1, y = 0, n = 0; n < 24; n++) {
            E[c + 5 * y] = (n + 1) * (n + 2) / 2 % 64;
            var l = y % 5, f = (2 * c + 3 * y) % 5;
            c = l, y = f;
          }
          for (var c = 0; c < 5; c++)
            for (var y = 0; y < 5; y++)
              o[c + 5 * y] = y + (2 * c + 3 * y) % 5 * 5;
          for (var C = 1, _ = 0; _ < 24; _++) {
            for (var A = 0, D = 0, W = 0; W < 7; W++) {
              if (C & 1) {
                var B = (1 << W) - 1;
                B < 32 ? D ^= 1 << B : A ^= 1 << B - 32;
              }
              C & 128 ? C = C << 1 ^ 113 : C <<= 1;
            }
            h[_] = r.create(A, D);
          }
        })();
        var s = [];
        (function() {
          for (var c = 0; c < 25; c++)
            s[c] = r.create();
        })();
        var d = t.SHA3 = u.extend({
          /**
           * Configuration options.
           *
           * @property {number} outputLength
           *   The desired number of bits in the output hash.
           *   Only values permitted are: 224, 256, 384, 512.
           *   Default: 512
           */
          cfg: u.cfg.extend({
            outputLength: 512
          }),
          _doReset: function() {
            for (var c = this._state = [], y = 0; y < 25; y++)
              c[y] = new r.init();
            this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32;
          },
          _doProcessBlock: function(c, y) {
            for (var n = this._state, l = this.blockSize / 2, f = 0; f < l; f++) {
              var C = c[y + 2 * f], _ = c[y + 2 * f + 1];
              C = (C << 8 | C >>> 24) & 16711935 | (C << 24 | C >>> 8) & 4278255360, _ = (_ << 8 | _ >>> 24) & 16711935 | (_ << 24 | _ >>> 8) & 4278255360;
              var A = n[f];
              A.high ^= _, A.low ^= C;
            }
            for (var D = 0; D < 24; D++) {
              for (var W = 0; W < 5; W++) {
                for (var B = 0, k = 0, S = 0; S < 5; S++) {
                  var A = n[W + 5 * S];
                  B ^= A.high, k ^= A.low;
                }
                var w = s[W];
                w.high = B, w.low = k;
              }
              for (var W = 0; W < 5; W++)
                for (var z = s[(W + 4) % 5], L = s[(W + 1) % 5], q = L.high, Q = L.low, B = z.high ^ (q << 1 | Q >>> 31), k = z.low ^ (Q << 1 | q >>> 31), S = 0; S < 5; S++) {
                  var A = n[W + 5 * S];
                  A.high ^= B, A.low ^= k;
                }
              for (var X = 1; X < 25; X++) {
                var B, k, A = n[X], Z = A.high, Y = A.low, R = E[X];
                R < 32 ? (B = Z << R | Y >>> 32 - R, k = Y << R | Z >>> 32 - R) : (B = Y << R - 32 | Z >>> 64 - R, k = Z << R - 32 | Y >>> 64 - R);
                var N = s[o[X]];
                N.high = B, N.low = k;
              }
              var H = s[0], j = n[0];
              H.high = j.high, H.low = j.low;
              for (var W = 0; W < 5; W++)
                for (var S = 0; S < 5; S++) {
                  var X = W + 5 * S, A = n[X], e0 = s[X], V = s[(W + 1) % 5 + 5 * S], a0 = s[(W + 2) % 5 + 5 * S];
                  A.high = e0.high ^ ~V.high & a0.high, A.low = e0.low ^ ~V.low & a0.low;
                }
              var A = n[0], I = h[D];
              A.high ^= I.high, A.low ^= I.low;
            }
          },
          _doFinalize: function() {
            var c = this._data, y = c.words;
            this._nDataBytes * 8;
            var n = c.sigBytes * 8, l = this.blockSize * 32;
            y[n >>> 5] |= 1 << 24 - n % 32, y[(e.ceil((n + 1) / l) * l >>> 5) - 1] |= 128, c.sigBytes = y.length * 4, this._process();
            for (var f = this._state, C = this.cfg.outputLength / 8, _ = C / 8, A = [], D = 0; D < _; D++) {
              var W = f[D], B = W.high, k = W.low;
              B = (B << 8 | B >>> 24) & 16711935 | (B << 24 | B >>> 8) & 4278255360, k = (k << 8 | k >>> 24) & 16711935 | (k << 24 | k >>> 8) & 4278255360, A.push(k), A.push(B);
            }
            return new b.init(A, C);
          },
          clone: function() {
            for (var c = u.clone.call(this), y = c._state = this._state.slice(0), n = 0; n < 25; n++)
              y[n] = y[n].clone();
            return c;
          }
        });
        x.SHA3 = u._createHelper(d), x.HmacSHA3 = u._createHmacHelper(d);
      }(Math), i.SHA3;
    });
  }(Re)), Re.exports;
}
var Se = { exports: {} }, br;
function jt() {
  return br || (br = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      /** @preserve
      			(c) 2012 by Cédric Mesnil. All rights reserved.
      
      			Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
      
      			    - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
      			    - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
      
      			THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
      			*/
      return function(e) {
        var x = i, a = x.lib, b = a.WordArray, u = a.Hasher, v = x.algo, r = b.create([
          0,
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15,
          7,
          4,
          13,
          1,
          10,
          6,
          15,
          3,
          12,
          0,
          9,
          5,
          2,
          14,
          11,
          8,
          3,
          10,
          14,
          4,
          9,
          15,
          8,
          1,
          2,
          7,
          0,
          6,
          13,
          11,
          5,
          12,
          1,
          9,
          11,
          10,
          0,
          8,
          12,
          4,
          13,
          3,
          7,
          15,
          14,
          5,
          6,
          2,
          4,
          0,
          5,
          9,
          7,
          12,
          2,
          10,
          14,
          1,
          3,
          8,
          11,
          6,
          15,
          13
        ]), t = b.create([
          5,
          14,
          7,
          0,
          9,
          2,
          11,
          4,
          13,
          6,
          15,
          8,
          1,
          10,
          3,
          12,
          6,
          11,
          3,
          7,
          0,
          13,
          5,
          10,
          14,
          15,
          8,
          12,
          4,
          9,
          1,
          2,
          15,
          5,
          1,
          3,
          7,
          14,
          6,
          9,
          11,
          8,
          12,
          2,
          10,
          0,
          4,
          13,
          8,
          6,
          4,
          1,
          3,
          11,
          15,
          0,
          5,
          12,
          2,
          13,
          9,
          7,
          10,
          14,
          12,
          15,
          10,
          4,
          1,
          5,
          8,
          7,
          6,
          2,
          13,
          14,
          0,
          3,
          9,
          11
        ]), E = b.create([
          11,
          14,
          15,
          12,
          5,
          8,
          7,
          9,
          11,
          13,
          14,
          15,
          6,
          7,
          9,
          8,
          7,
          6,
          8,
          13,
          11,
          9,
          7,
          15,
          7,
          12,
          15,
          9,
          11,
          7,
          13,
          12,
          11,
          13,
          6,
          7,
          14,
          9,
          13,
          15,
          14,
          8,
          13,
          6,
          5,
          12,
          7,
          5,
          11,
          12,
          14,
          15,
          14,
          15,
          9,
          8,
          9,
          14,
          5,
          6,
          8,
          6,
          5,
          12,
          9,
          15,
          5,
          11,
          6,
          8,
          13,
          12,
          5,
          12,
          13,
          14,
          11,
          8,
          5,
          6
        ]), o = b.create([
          8,
          9,
          9,
          11,
          13,
          15,
          15,
          5,
          7,
          7,
          8,
          11,
          14,
          14,
          12,
          6,
          9,
          13,
          15,
          7,
          12,
          8,
          9,
          11,
          7,
          7,
          12,
          7,
          6,
          15,
          13,
          11,
          9,
          7,
          15,
          11,
          8,
          6,
          6,
          14,
          12,
          13,
          5,
          14,
          13,
          13,
          7,
          5,
          15,
          5,
          8,
          11,
          14,
          14,
          6,
          14,
          6,
          9,
          12,
          9,
          12,
          5,
          15,
          8,
          8,
          5,
          12,
          9,
          12,
          5,
          14,
          6,
          8,
          13,
          6,
          5,
          15,
          13,
          11,
          11
        ]), h = b.create([0, 1518500249, 1859775393, 2400959708, 2840853838]), s = b.create([1352829926, 1548603684, 1836072691, 2053994217, 0]), d = v.RIPEMD160 = u.extend({
          _doReset: function() {
            this._hash = b.create([1732584193, 4023233417, 2562383102, 271733878, 3285377520]);
          },
          _doProcessBlock: function(_, A) {
            for (var D = 0; D < 16; D++) {
              var W = A + D, B = _[W];
              _[W] = (B << 8 | B >>> 24) & 16711935 | (B << 24 | B >>> 8) & 4278255360;
            }
            var k = this._hash.words, S = h.words, w = s.words, z = r.words, L = t.words, q = E.words, Q = o.words, X, Z, Y, R, N, H, j, e0, V, a0;
            H = X = k[0], j = Z = k[1], e0 = Y = k[2], V = R = k[3], a0 = N = k[4];
            for (var I, D = 0; D < 80; D += 1)
              I = X + _[A + z[D]] | 0, D < 16 ? I += c(Z, Y, R) + S[0] : D < 32 ? I += y(Z, Y, R) + S[1] : D < 48 ? I += n(Z, Y, R) + S[2] : D < 64 ? I += l(Z, Y, R) + S[3] : I += f(Z, Y, R) + S[4], I = I | 0, I = C(I, q[D]), I = I + N | 0, X = N, N = R, R = C(Y, 10), Y = Z, Z = I, I = H + _[A + L[D]] | 0, D < 16 ? I += f(j, e0, V) + w[0] : D < 32 ? I += l(j, e0, V) + w[1] : D < 48 ? I += n(j, e0, V) + w[2] : D < 64 ? I += y(j, e0, V) + w[3] : I += c(j, e0, V) + w[4], I = I | 0, I = C(I, Q[D]), I = I + a0 | 0, H = a0, a0 = V, V = C(e0, 10), e0 = j, j = I;
            I = k[1] + Y + V | 0, k[1] = k[2] + R + a0 | 0, k[2] = k[3] + N + H | 0, k[3] = k[4] + X + j | 0, k[4] = k[0] + Z + e0 | 0, k[0] = I;
          },
          _doFinalize: function() {
            var _ = this._data, A = _.words, D = this._nDataBytes * 8, W = _.sigBytes * 8;
            A[W >>> 5] |= 128 << 24 - W % 32, A[(W + 64 >>> 9 << 4) + 14] = (D << 8 | D >>> 24) & 16711935 | (D << 24 | D >>> 8) & 4278255360, _.sigBytes = (A.length + 1) * 4, this._process();
            for (var B = this._hash, k = B.words, S = 0; S < 5; S++) {
              var w = k[S];
              k[S] = (w << 8 | w >>> 24) & 16711935 | (w << 24 | w >>> 8) & 4278255360;
            }
            return B;
          },
          clone: function() {
            var _ = u.clone.call(this);
            return _._hash = this._hash.clone(), _;
          }
        });
        function c(_, A, D) {
          return _ ^ A ^ D;
        }
        function y(_, A, D) {
          return _ & A | ~_ & D;
        }
        function n(_, A, D) {
          return (_ | ~A) ^ D;
        }
        function l(_, A, D) {
          return _ & D | A & ~D;
        }
        function f(_, A, D) {
          return _ ^ (A | ~D);
        }
        function C(_, A) {
          return _ << A | _ >>> 32 - A;
        }
        x.RIPEMD160 = u._createHelper(d), x.HmacRIPEMD160 = u._createHmacHelper(d);
      }(), i.RIPEMD160;
    });
  }(Se)), Se.exports;
}
var je = { exports: {} }, Br;
function nr() {
  return Br || (Br = 1, function(m, F) {
    (function(i, e) {
      m.exports = e(U());
    })(M, function(i) {
      (function() {
        var e = i, x = e.lib, a = x.Base, b = e.enc, u = b.Utf8, v = e.algo;
        v.HMAC = a.extend({
          /**
           * Initializes a newly created HMAC.
           *
           * @param {Hasher} hasher The hash algorithm to use.
           * @param {WordArray|string} key The secret key.
           *
           * @example
           *
           *     var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
           */
          init: function(r, t) {
            r = this._hasher = new r.init(), typeof t == "string" && (t = u.parse(t));
            var E = r.blockSize, o = E * 4;
            t.sigBytes > o && (t = r.finalize(t)), t.clamp();
            for (var h = this._oKey = t.clone(), s = this._iKey = t.clone(), d = h.words, c = s.words, y = 0; y < E; y++)
              d[y] ^= 1549556828, c[y] ^= 909522486;
            h.sigBytes = s.sigBytes = o, this.reset();
          },
          /**
           * Resets this HMAC to its initial state.
           *
           * @example
           *
           *     hmacHasher.reset();
           */
          reset: function() {
            var r = this._hasher;
            r.reset(), r.update(this._iKey);
          },
          /**
           * Updates this HMAC with a message.
           *
           * @param {WordArray|string} messageUpdate The message to append.
           *
           * @return {HMAC} This HMAC instance.
           *
           * @example
           *
           *     hmacHasher.update('message');
           *     hmacHasher.update(wordArray);
           */
          update: function(r) {
            return this._hasher.update(r), this;
          },
          /**
           * Finalizes the HMAC computation.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} messageUpdate (Optional) A final message update.
           *
           * @return {WordArray} The HMAC.
           *
           * @example
           *
           *     var hmac = hmacHasher.finalize();
           *     var hmac = hmacHasher.finalize('message');
           *     var hmac = hmacHasher.finalize(wordArray);
           */
          finalize: function(r) {
            var t = this._hasher, E = t.finalize(r);
            t.reset();
            var o = t.finalize(this._oKey.clone().concat(E));
            return o;
          }
        });
      })();
    });
  }(je)), je.exports;
}
var Ne = { exports: {} }, _r;
function Nt() {
  return _r || (_r = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), ar(), nr());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.Base, b = x.WordArray, u = e.algo, v = u.SHA256, r = u.HMAC, t = u.PBKDF2 = a.extend({
          /**
           * Configuration options.
           *
           * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
           * @property {Hasher} hasher The hasher to use. Default: SHA256
           * @property {number} iterations The number of iterations to perform. Default: 250000
           */
          cfg: a.extend({
            keySize: 128 / 32,
            hasher: v,
            iterations: 25e4
          }),
          /**
           * Initializes a newly created key derivation function.
           *
           * @param {Object} cfg (Optional) The configuration options to use for the derivation.
           *
           * @example
           *
           *     var kdf = CryptoJS.algo.PBKDF2.create();
           *     var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8 });
           *     var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8, iterations: 1000 });
           */
          init: function(E) {
            this.cfg = this.cfg.extend(E);
          },
          /**
           * Computes the Password-Based Key Derivation Function 2.
           *
           * @param {WordArray|string} password The password.
           * @param {WordArray|string} salt A salt.
           *
           * @return {WordArray} The derived key.
           *
           * @example
           *
           *     var key = kdf.compute(password, salt);
           */
          compute: function(E, o) {
            for (var h = this.cfg, s = r.create(h.hasher, E), d = b.create(), c = b.create([1]), y = d.words, n = c.words, l = h.keySize, f = h.iterations; y.length < l; ) {
              var C = s.update(o).finalize(c);
              s.reset();
              for (var _ = C.words, A = _.length, D = C, W = 1; W < f; W++) {
                D = s.finalize(D), s.reset();
                for (var B = D.words, k = 0; k < A; k++)
                  _[k] ^= B[k];
              }
              d.concat(C), n[0]++;
            }
            return d.sigBytes = l * 4, d;
          }
        });
        e.PBKDF2 = function(E, o, h) {
          return t.create(h).compute(E, o);
        };
      }(), i.PBKDF2;
    });
  }(Ne)), Ne.exports;
}
var Pe = { exports: {} }, Ar;
function D0() {
  return Ar || (Ar = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), Ur(), nr());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.Base, b = x.WordArray, u = e.algo, v = u.MD5, r = u.EvpKDF = a.extend({
          /**
           * Configuration options.
           *
           * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
           * @property {Hasher} hasher The hash algorithm to use. Default: MD5
           * @property {number} iterations The number of iterations to perform. Default: 1
           */
          cfg: a.extend({
            keySize: 128 / 32,
            hasher: v,
            iterations: 1
          }),
          /**
           * Initializes a newly created key derivation function.
           *
           * @param {Object} cfg (Optional) The configuration options to use for the derivation.
           *
           * @example
           *
           *     var kdf = CryptoJS.algo.EvpKDF.create();
           *     var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8 });
           *     var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8, iterations: 1000 });
           */
          init: function(t) {
            this.cfg = this.cfg.extend(t);
          },
          /**
           * Derives a key from a password.
           *
           * @param {WordArray|string} password The password.
           * @param {WordArray|string} salt A salt.
           *
           * @return {WordArray} The derived key.
           *
           * @example
           *
           *     var key = kdf.compute(password, salt);
           */
          compute: function(t, E) {
            for (var o, h = this.cfg, s = h.hasher.create(), d = b.create(), c = d.words, y = h.keySize, n = h.iterations; c.length < y; ) {
              o && s.update(o), o = s.update(t).finalize(E), s.reset();
              for (var l = 1; l < n; l++)
                o = s.finalize(o), s.reset();
              d.concat(o);
            }
            return d.sigBytes = y * 4, d;
          }
        });
        e.EvpKDF = function(t, E, o) {
          return r.create(o).compute(t, E);
        };
      }(), i.EvpKDF;
    });
  }(Pe)), Pe.exports;
}
var He = { exports: {} }, Fr;
function n0() {
  return Fr || (Fr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), D0());
    })(M, function(i) {
      i.lib.Cipher || function(e) {
        var x = i, a = x.lib, b = a.Base, u = a.WordArray, v = a.BufferedBlockAlgorithm, r = x.enc;
        r.Utf8;
        var t = r.Base64, E = x.algo, o = E.EvpKDF, h = a.Cipher = v.extend({
          /**
           * Configuration options.
           *
           * @property {WordArray} iv The IV to use for this operation.
           */
          cfg: b.extend(),
          /**
           * Creates this cipher in encryption mode.
           *
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {Cipher} A cipher instance.
           *
           * @static
           *
           * @example
           *
           *     var cipher = CryptoJS.algo.AES.createEncryptor(keyWordArray, { iv: ivWordArray });
           */
          createEncryptor: function(B, k) {
            return this.create(this._ENC_XFORM_MODE, B, k);
          },
          /**
           * Creates this cipher in decryption mode.
           *
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {Cipher} A cipher instance.
           *
           * @static
           *
           * @example
           *
           *     var cipher = CryptoJS.algo.AES.createDecryptor(keyWordArray, { iv: ivWordArray });
           */
          createDecryptor: function(B, k) {
            return this.create(this._DEC_XFORM_MODE, B, k);
          },
          /**
           * Initializes a newly created cipher.
           *
           * @param {number} xformMode Either the encryption or decryption transormation mode constant.
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @example
           *
           *     var cipher = CryptoJS.algo.AES.create(CryptoJS.algo.AES._ENC_XFORM_MODE, keyWordArray, { iv: ivWordArray });
           */
          init: function(B, k, S) {
            this.cfg = this.cfg.extend(S), this._xformMode = B, this._key = k, this.reset();
          },
          /**
           * Resets this cipher to its initial state.
           *
           * @example
           *
           *     cipher.reset();
           */
          reset: function() {
            v.reset.call(this), this._doReset();
          },
          /**
           * Adds data to be encrypted or decrypted.
           *
           * @param {WordArray|string} dataUpdate The data to encrypt or decrypt.
           *
           * @return {WordArray} The data after processing.
           *
           * @example
           *
           *     var encrypted = cipher.process('data');
           *     var encrypted = cipher.process(wordArray);
           */
          process: function(B) {
            return this._append(B), this._process();
          },
          /**
           * Finalizes the encryption or decryption process.
           * Note that the finalize operation is effectively a destructive, read-once operation.
           *
           * @param {WordArray|string} dataUpdate The final data to encrypt or decrypt.
           *
           * @return {WordArray} The data after final processing.
           *
           * @example
           *
           *     var encrypted = cipher.finalize();
           *     var encrypted = cipher.finalize('data');
           *     var encrypted = cipher.finalize(wordArray);
           */
          finalize: function(B) {
            B && this._append(B);
            var k = this._doFinalize();
            return k;
          },
          keySize: 128 / 32,
          ivSize: 128 / 32,
          _ENC_XFORM_MODE: 1,
          _DEC_XFORM_MODE: 2,
          /**
           * Creates shortcut functions to a cipher's object interface.
           *
           * @param {Cipher} cipher The cipher to create a helper for.
           *
           * @return {Object} An object with encrypt and decrypt shortcut functions.
           *
           * @static
           *
           * @example
           *
           *     var AES = CryptoJS.lib.Cipher._createHelper(CryptoJS.algo.AES);
           */
          _createHelper: function() {
            function B(k) {
              return typeof k == "string" ? W : _;
            }
            return function(k) {
              return {
                encrypt: function(S, w, z) {
                  return B(w).encrypt(k, S, w, z);
                },
                decrypt: function(S, w, z) {
                  return B(w).decrypt(k, S, w, z);
                }
              };
            };
          }()
        });
        a.StreamCipher = h.extend({
          _doFinalize: function() {
            var B = this._process(!0);
            return B;
          },
          blockSize: 1
        });
        var s = x.mode = {}, d = a.BlockCipherMode = b.extend({
          /**
           * Creates this mode for encryption.
           *
           * @param {Cipher} cipher A block cipher instance.
           * @param {Array} iv The IV words.
           *
           * @static
           *
           * @example
           *
           *     var mode = CryptoJS.mode.CBC.createEncryptor(cipher, iv.words);
           */
          createEncryptor: function(B, k) {
            return this.Encryptor.create(B, k);
          },
          /**
           * Creates this mode for decryption.
           *
           * @param {Cipher} cipher A block cipher instance.
           * @param {Array} iv The IV words.
           *
           * @static
           *
           * @example
           *
           *     var mode = CryptoJS.mode.CBC.createDecryptor(cipher, iv.words);
           */
          createDecryptor: function(B, k) {
            return this.Decryptor.create(B, k);
          },
          /**
           * Initializes a newly created mode.
           *
           * @param {Cipher} cipher A block cipher instance.
           * @param {Array} iv The IV words.
           *
           * @example
           *
           *     var mode = CryptoJS.mode.CBC.Encryptor.create(cipher, iv.words);
           */
          init: function(B, k) {
            this._cipher = B, this._iv = k;
          }
        }), c = s.CBC = function() {
          var B = d.extend();
          B.Encryptor = B.extend({
            /**
             * Processes the data block at offset.
             *
             * @param {Array} words The data words to operate on.
             * @param {number} offset The offset where the block starts.
             *
             * @example
             *
             *     mode.processBlock(data.words, offset);
             */
            processBlock: function(S, w) {
              var z = this._cipher, L = z.blockSize;
              k.call(this, S, w, L), z.encryptBlock(S, w), this._prevBlock = S.slice(w, w + L);
            }
          }), B.Decryptor = B.extend({
            /**
             * Processes the data block at offset.
             *
             * @param {Array} words The data words to operate on.
             * @param {number} offset The offset where the block starts.
             *
             * @example
             *
             *     mode.processBlock(data.words, offset);
             */
            processBlock: function(S, w) {
              var z = this._cipher, L = z.blockSize, q = S.slice(w, w + L);
              z.decryptBlock(S, w), k.call(this, S, w, L), this._prevBlock = q;
            }
          });
          function k(S, w, z) {
            var L, q = this._iv;
            q ? (L = q, this._iv = e) : L = this._prevBlock;
            for (var Q = 0; Q < z; Q++)
              S[w + Q] ^= L[Q];
          }
          return B;
        }(), y = x.pad = {}, n = y.Pkcs7 = {
          /**
           * Pads data using the algorithm defined in PKCS #5/7.
           *
           * @param {WordArray} data The data to pad.
           * @param {number} blockSize The multiple that the data should be padded to.
           *
           * @static
           *
           * @example
           *
           *     CryptoJS.pad.Pkcs7.pad(wordArray, 4);
           */
          pad: function(B, k) {
            for (var S = k * 4, w = S - B.sigBytes % S, z = w << 24 | w << 16 | w << 8 | w, L = [], q = 0; q < w; q += 4)
              L.push(z);
            var Q = u.create(L, w);
            B.concat(Q);
          },
          /**
           * Unpads data that had been padded using the algorithm defined in PKCS #5/7.
           *
           * @param {WordArray} data The data to unpad.
           *
           * @static
           *
           * @example
           *
           *     CryptoJS.pad.Pkcs7.unpad(wordArray);
           */
          unpad: function(B) {
            var k = B.words[B.sigBytes - 1 >>> 2] & 255;
            B.sigBytes -= k;
          }
        };
        a.BlockCipher = h.extend({
          /**
           * Configuration options.
           *
           * @property {Mode} mode The block mode to use. Default: CBC
           * @property {Padding} padding The padding strategy to use. Default: Pkcs7
           */
          cfg: h.cfg.extend({
            mode: c,
            padding: n
          }),
          reset: function() {
            var B;
            h.reset.call(this);
            var k = this.cfg, S = k.iv, w = k.mode;
            this._xformMode == this._ENC_XFORM_MODE ? B = w.createEncryptor : (B = w.createDecryptor, this._minBufferSize = 1), this._mode && this._mode.__creator == B ? this._mode.init(this, S && S.words) : (this._mode = B.call(w, this, S && S.words), this._mode.__creator = B);
          },
          _doProcessBlock: function(B, k) {
            this._mode.processBlock(B, k);
          },
          _doFinalize: function() {
            var B, k = this.cfg.padding;
            return this._xformMode == this._ENC_XFORM_MODE ? (k.pad(this._data, this.blockSize), B = this._process(!0)) : (B = this._process(!0), k.unpad(B)), B;
          },
          blockSize: 128 / 32
        });
        var l = a.CipherParams = b.extend({
          /**
           * Initializes a newly created cipher params object.
           *
           * @param {Object} cipherParams An object with any of the possible cipher parameters.
           *
           * @example
           *
           *     var cipherParams = CryptoJS.lib.CipherParams.create({
           *         ciphertext: ciphertextWordArray,
           *         key: keyWordArray,
           *         iv: ivWordArray,
           *         salt: saltWordArray,
           *         algorithm: CryptoJS.algo.AES,
           *         mode: CryptoJS.mode.CBC,
           *         padding: CryptoJS.pad.PKCS7,
           *         blockSize: 4,
           *         formatter: CryptoJS.format.OpenSSL
           *     });
           */
          init: function(B) {
            this.mixIn(B);
          },
          /**
           * Converts this cipher params object to a string.
           *
           * @param {Format} formatter (Optional) The formatting strategy to use.
           *
           * @return {string} The stringified cipher params.
           *
           * @throws Error If neither the formatter nor the default formatter is set.
           *
           * @example
           *
           *     var string = cipherParams + '';
           *     var string = cipherParams.toString();
           *     var string = cipherParams.toString(CryptoJS.format.OpenSSL);
           */
          toString: function(B) {
            return (B || this.formatter).stringify(this);
          }
        }), f = x.format = {}, C = f.OpenSSL = {
          /**
           * Converts a cipher params object to an OpenSSL-compatible string.
           *
           * @param {CipherParams} cipherParams The cipher params object.
           *
           * @return {string} The OpenSSL-compatible string.
           *
           * @static
           *
           * @example
           *
           *     var openSSLString = CryptoJS.format.OpenSSL.stringify(cipherParams);
           */
          stringify: function(B) {
            var k, S = B.ciphertext, w = B.salt;
            return w ? k = u.create([1398893684, 1701076831]).concat(w).concat(S) : k = S, k.toString(t);
          },
          /**
           * Converts an OpenSSL-compatible string to a cipher params object.
           *
           * @param {string} openSSLStr The OpenSSL-compatible string.
           *
           * @return {CipherParams} The cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var cipherParams = CryptoJS.format.OpenSSL.parse(openSSLString);
           */
          parse: function(B) {
            var k, S = t.parse(B), w = S.words;
            return w[0] == 1398893684 && w[1] == 1701076831 && (k = u.create(w.slice(2, 4)), w.splice(0, 4), S.sigBytes -= 16), l.create({ ciphertext: S, salt: k });
          }
        }, _ = a.SerializableCipher = b.extend({
          /**
           * Configuration options.
           *
           * @property {Formatter} format The formatting strategy to convert cipher param objects to and from a string. Default: OpenSSL
           */
          cfg: b.extend({
            format: C
          }),
          /**
           * Encrypts a message.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {WordArray|string} message The message to encrypt.
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {CipherParams} A cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key);
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv });
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv, format: CryptoJS.format.OpenSSL });
           */
          encrypt: function(B, k, S, w) {
            w = this.cfg.extend(w);
            var z = B.createEncryptor(S, w), L = z.finalize(k), q = z.cfg;
            return l.create({
              ciphertext: L,
              key: S,
              iv: q.iv,
              algorithm: B,
              mode: q.mode,
              padding: q.padding,
              blockSize: B.blockSize,
              formatter: w.format
            });
          },
          /**
           * Decrypts serialized ciphertext.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
           * @param {WordArray} key The key.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {WordArray} The plaintext.
           *
           * @static
           *
           * @example
           *
           *     var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, key, { iv: iv, format: CryptoJS.format.OpenSSL });
           *     var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, key, { iv: iv, format: CryptoJS.format.OpenSSL });
           */
          decrypt: function(B, k, S, w) {
            w = this.cfg.extend(w), k = this._parse(k, w.format);
            var z = B.createDecryptor(S, w).finalize(k.ciphertext);
            return z;
          },
          /**
           * Converts serialized ciphertext to CipherParams,
           * else assumed CipherParams already and returns ciphertext unchanged.
           *
           * @param {CipherParams|string} ciphertext The ciphertext.
           * @param {Formatter} format The formatting strategy to use to parse serialized ciphertext.
           *
           * @return {CipherParams} The unserialized ciphertext.
           *
           * @static
           *
           * @example
           *
           *     var ciphertextParams = CryptoJS.lib.SerializableCipher._parse(ciphertextStringOrParams, format);
           */
          _parse: function(B, k) {
            return typeof B == "string" ? k.parse(B, this) : B;
          }
        }), A = x.kdf = {}, D = A.OpenSSL = {
          /**
           * Derives a key and IV from a password.
           *
           * @param {string} password The password to derive from.
           * @param {number} keySize The size in words of the key to generate.
           * @param {number} ivSize The size in words of the IV to generate.
           * @param {WordArray|string} salt (Optional) A 64-bit salt to use. If omitted, a salt will be generated randomly.
           *
           * @return {CipherParams} A cipher params object with the key, IV, and salt.
           *
           * @static
           *
           * @example
           *
           *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32);
           *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32, 'saltsalt');
           */
          execute: function(B, k, S, w, z) {
            if (w || (w = u.random(64 / 8)), z)
              var L = o.create({ keySize: k + S, hasher: z }).compute(B, w);
            else
              var L = o.create({ keySize: k + S }).compute(B, w);
            var q = u.create(L.words.slice(k), S * 4);
            return L.sigBytes = k * 4, l.create({ key: L, iv: q, salt: w });
          }
        }, W = a.PasswordBasedCipher = _.extend({
          /**
           * Configuration options.
           *
           * @property {KDF} kdf The key derivation function to use to generate a key and IV from a password. Default: OpenSSL
           */
          cfg: _.cfg.extend({
            kdf: D
          }),
          /**
           * Encrypts a message using a password.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {WordArray|string} message The message to encrypt.
           * @param {string} password The password.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {CipherParams} A cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password');
           *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password', { format: CryptoJS.format.OpenSSL });
           */
          encrypt: function(B, k, S, w) {
            w = this.cfg.extend(w);
            var z = w.kdf.execute(S, B.keySize, B.ivSize, w.salt, w.hasher);
            w.iv = z.iv;
            var L = _.encrypt.call(this, B, k, z.key, w);
            return L.mixIn(z), L;
          },
          /**
           * Decrypts serialized ciphertext using a password.
           *
           * @param {Cipher} cipher The cipher algorithm to use.
           * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
           * @param {string} password The password.
           * @param {Object} cfg (Optional) The configuration options to use for this operation.
           *
           * @return {WordArray} The plaintext.
           *
           * @static
           *
           * @example
           *
           *     var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, 'password', { format: CryptoJS.format.OpenSSL });
           *     var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, 'password', { format: CryptoJS.format.OpenSSL });
           */
          decrypt: function(B, k, S, w) {
            w = this.cfg.extend(w), k = this._parse(k, w.format);
            var z = w.kdf.execute(S, B.keySize, B.ivSize, k.salt, w.hasher);
            w.iv = z.iv;
            var L = _.decrypt.call(this, B, k, z.key, w);
            return L;
          }
        });
      }();
    });
  }(He)), He.exports;
}
var We = { exports: {} }, kr;
function Pt() {
  return kr || (kr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.mode.CFB = function() {
        var e = i.lib.BlockCipherMode.extend();
        e.Encryptor = e.extend({
          processBlock: function(a, b) {
            var u = this._cipher, v = u.blockSize;
            x.call(this, a, b, v, u), this._prevBlock = a.slice(b, b + v);
          }
        }), e.Decryptor = e.extend({
          processBlock: function(a, b) {
            var u = this._cipher, v = u.blockSize, r = a.slice(b, b + v);
            x.call(this, a, b, v, u), this._prevBlock = r;
          }
        });
        function x(a, b, u, v) {
          var r, t = this._iv;
          t ? (r = t.slice(0), this._iv = void 0) : r = this._prevBlock, v.encryptBlock(r, 0);
          for (var E = 0; E < u; E++)
            a[b + E] ^= r[E];
        }
        return e;
      }(), i.mode.CFB;
    });
  }(We)), We.exports;
}
var Te = { exports: {} }, Dr;
function Ht() {
  return Dr || (Dr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.mode.CTR = function() {
        var e = i.lib.BlockCipherMode.extend(), x = e.Encryptor = e.extend({
          processBlock: function(a, b) {
            var u = this._cipher, v = u.blockSize, r = this._iv, t = this._counter;
            r && (t = this._counter = r.slice(0), this._iv = void 0);
            var E = t.slice(0);
            u.encryptBlock(E, 0), t[v - 1] = t[v - 1] + 1 | 0;
            for (var o = 0; o < v; o++)
              a[b + o] ^= E[o];
          }
        });
        return e.Decryptor = x, e;
      }(), i.mode.CTR;
    });
  }(Te)), Te.exports;
}
var ze = { exports: {} }, wr;
function Wt() {
  return wr || (wr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      /** @preserve
       * Counter block mode compatible with  Dr Brian Gladman fileenc.c
       * derived from CryptoJS.mode.CTR
       * Jan Hruby jhruby.web@gmail.com
       */
      return i.mode.CTRGladman = function() {
        var e = i.lib.BlockCipherMode.extend();
        function x(u) {
          if ((u >> 24 & 255) === 255) {
            var v = u >> 16 & 255, r = u >> 8 & 255, t = u & 255;
            v === 255 ? (v = 0, r === 255 ? (r = 0, t === 255 ? t = 0 : ++t) : ++r) : ++v, u = 0, u += v << 16, u += r << 8, u += t;
          } else
            u += 1 << 24;
          return u;
        }
        function a(u) {
          return (u[0] = x(u[0])) === 0 && (u[1] = x(u[1])), u;
        }
        var b = e.Encryptor = e.extend({
          processBlock: function(u, v) {
            var r = this._cipher, t = r.blockSize, E = this._iv, o = this._counter;
            E && (o = this._counter = E.slice(0), this._iv = void 0), a(o);
            var h = o.slice(0);
            r.encryptBlock(h, 0);
            for (var s = 0; s < t; s++)
              u[v + s] ^= h[s];
          }
        });
        return e.Decryptor = b, e;
      }(), i.mode.CTRGladman;
    });
  }(ze)), ze.exports;
}
var Le = { exports: {} }, Rr;
function Tt() {
  return Rr || (Rr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.mode.OFB = function() {
        var e = i.lib.BlockCipherMode.extend(), x = e.Encryptor = e.extend({
          processBlock: function(a, b) {
            var u = this._cipher, v = u.blockSize, r = this._iv, t = this._keystream;
            r && (t = this._keystream = r.slice(0), this._iv = void 0), u.encryptBlock(t, 0);
            for (var E = 0; E < v; E++)
              a[b + E] ^= t[E];
          }
        });
        return e.Decryptor = x, e;
      }(), i.mode.OFB;
    });
  }(Le)), Le.exports;
}
var Oe = { exports: {} }, Sr;
function zt() {
  return Sr || (Sr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.mode.ECB = function() {
        var e = i.lib.BlockCipherMode.extend();
        return e.Encryptor = e.extend({
          processBlock: function(x, a) {
            this._cipher.encryptBlock(x, a);
          }
        }), e.Decryptor = e.extend({
          processBlock: function(x, a) {
            this._cipher.decryptBlock(x, a);
          }
        }), e;
      }(), i.mode.ECB;
    });
  }(Oe)), Oe.exports;
}
var Ie = { exports: {} }, jr;
function Lt() {
  return jr || (jr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.pad.AnsiX923 = {
        pad: function(e, x) {
          var a = e.sigBytes, b = x * 4, u = b - a % b, v = a + u - 1;
          e.clamp(), e.words[v >>> 2] |= u << 24 - v % 4 * 8, e.sigBytes += u;
        },
        unpad: function(e) {
          var x = e.words[e.sigBytes - 1 >>> 2] & 255;
          e.sigBytes -= x;
        }
      }, i.pad.Ansix923;
    });
  }(Ie)), Ie.exports;
}
var qe = { exports: {} }, Nr;
function Ot() {
  return Nr || (Nr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.pad.Iso10126 = {
        pad: function(e, x) {
          var a = x * 4, b = a - e.sigBytes % a;
          e.concat(i.lib.WordArray.random(b - 1)).concat(i.lib.WordArray.create([b << 24], 1));
        },
        unpad: function(e) {
          var x = e.words[e.sigBytes - 1 >>> 2] & 255;
          e.sigBytes -= x;
        }
      }, i.pad.Iso10126;
    });
  }(qe)), qe.exports;
}
var Me = { exports: {} }, Pr;
function It() {
  return Pr || (Pr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.pad.Iso97971 = {
        pad: function(e, x) {
          e.concat(i.lib.WordArray.create([2147483648], 1)), i.pad.ZeroPadding.pad(e, x);
        },
        unpad: function(e) {
          i.pad.ZeroPadding.unpad(e), e.sigBytes--;
        }
      }, i.pad.Iso97971;
    });
  }(Me)), Me.exports;
}
var $e = { exports: {} }, Hr;
function qt() {
  return Hr || (Hr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.pad.ZeroPadding = {
        pad: function(e, x) {
          var a = x * 4;
          e.clamp(), e.sigBytes += a - (e.sigBytes % a || a);
        },
        unpad: function(e) {
          for (var x = e.words, a = e.sigBytes - 1, a = e.sigBytes - 1; a >= 0; a--)
            if (x[a >>> 2] >>> 24 - a % 4 * 8 & 255) {
              e.sigBytes = a + 1;
              break;
            }
        }
      }, i.pad.ZeroPadding;
    });
  }($e)), $e.exports;
}
var Ue = { exports: {} }, Wr;
function Mt() {
  return Wr || (Wr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return i.pad.NoPadding = {
        pad: function() {
        },
        unpad: function() {
        }
      }, i.pad.NoPadding;
    });
  }(Ue)), Ue.exports;
}
var Ke = { exports: {} }, Tr;
function $t() {
  return Tr || (Tr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), n0());
    })(M, function(i) {
      return function(e) {
        var x = i, a = x.lib, b = a.CipherParams, u = x.enc, v = u.Hex, r = x.format;
        r.Hex = {
          /**
           * Converts the ciphertext of a cipher params object to a hexadecimally encoded string.
           *
           * @param {CipherParams} cipherParams The cipher params object.
           *
           * @return {string} The hexadecimally encoded string.
           *
           * @static
           *
           * @example
           *
           *     var hexString = CryptoJS.format.Hex.stringify(cipherParams);
           */
          stringify: function(t) {
            return t.ciphertext.toString(v);
          },
          /**
           * Converts a hexadecimally encoded ciphertext string to a cipher params object.
           *
           * @param {string} input The hexadecimally encoded string.
           *
           * @return {CipherParams} The cipher params object.
           *
           * @static
           *
           * @example
           *
           *     var cipherParams = CryptoJS.format.Hex.parse(hexString);
           */
          parse: function(t) {
            var E = v.parse(t);
            return b.create({ ciphertext: E });
          }
        };
      }(), i.format.Hex;
    });
  }(Ke)), Ke.exports;
}
var Xe = { exports: {} }, zr;
function Ut() {
  return zr || (zr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), P0(), H0(), D0(), n0());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.BlockCipher, b = e.algo, u = [], v = [], r = [], t = [], E = [], o = [], h = [], s = [], d = [], c = [];
        (function() {
          for (var l = [], f = 0; f < 256; f++)
            f < 128 ? l[f] = f << 1 : l[f] = f << 1 ^ 283;
          for (var C = 0, _ = 0, f = 0; f < 256; f++) {
            var A = _ ^ _ << 1 ^ _ << 2 ^ _ << 3 ^ _ << 4;
            A = A >>> 8 ^ A & 255 ^ 99, u[C] = A, v[A] = C;
            var D = l[C], W = l[D], B = l[W], k = l[A] * 257 ^ A * 16843008;
            r[C] = k << 24 | k >>> 8, t[C] = k << 16 | k >>> 16, E[C] = k << 8 | k >>> 24, o[C] = k;
            var k = B * 16843009 ^ W * 65537 ^ D * 257 ^ C * 16843008;
            h[A] = k << 24 | k >>> 8, s[A] = k << 16 | k >>> 16, d[A] = k << 8 | k >>> 24, c[A] = k, C ? (C = D ^ l[l[l[B ^ D]]], _ ^= l[l[_]]) : C = _ = 1;
          }
        })();
        var y = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54], n = b.AES = a.extend({
          _doReset: function() {
            var l;
            if (!(this._nRounds && this._keyPriorReset === this._key)) {
              for (var f = this._keyPriorReset = this._key, C = f.words, _ = f.sigBytes / 4, A = this._nRounds = _ + 6, D = (A + 1) * 4, W = this._keySchedule = [], B = 0; B < D; B++)
                B < _ ? W[B] = C[B] : (l = W[B - 1], B % _ ? _ > 6 && B % _ == 4 && (l = u[l >>> 24] << 24 | u[l >>> 16 & 255] << 16 | u[l >>> 8 & 255] << 8 | u[l & 255]) : (l = l << 8 | l >>> 24, l = u[l >>> 24] << 24 | u[l >>> 16 & 255] << 16 | u[l >>> 8 & 255] << 8 | u[l & 255], l ^= y[B / _ | 0] << 24), W[B] = W[B - _] ^ l);
              for (var k = this._invKeySchedule = [], S = 0; S < D; S++) {
                var B = D - S;
                if (S % 4)
                  var l = W[B];
                else
                  var l = W[B - 4];
                S < 4 || B <= 4 ? k[S] = l : k[S] = h[u[l >>> 24]] ^ s[u[l >>> 16 & 255]] ^ d[u[l >>> 8 & 255]] ^ c[u[l & 255]];
              }
            }
          },
          encryptBlock: function(l, f) {
            this._doCryptBlock(l, f, this._keySchedule, r, t, E, o, u);
          },
          decryptBlock: function(l, f) {
            var C = l[f + 1];
            l[f + 1] = l[f + 3], l[f + 3] = C, this._doCryptBlock(l, f, this._invKeySchedule, h, s, d, c, v);
            var C = l[f + 1];
            l[f + 1] = l[f + 3], l[f + 3] = C;
          },
          _doCryptBlock: function(l, f, C, _, A, D, W, B) {
            for (var k = this._nRounds, S = l[f] ^ C[0], w = l[f + 1] ^ C[1], z = l[f + 2] ^ C[2], L = l[f + 3] ^ C[3], q = 4, Q = 1; Q < k; Q++) {
              var X = _[S >>> 24] ^ A[w >>> 16 & 255] ^ D[z >>> 8 & 255] ^ W[L & 255] ^ C[q++], Z = _[w >>> 24] ^ A[z >>> 16 & 255] ^ D[L >>> 8 & 255] ^ W[S & 255] ^ C[q++], Y = _[z >>> 24] ^ A[L >>> 16 & 255] ^ D[S >>> 8 & 255] ^ W[w & 255] ^ C[q++], R = _[L >>> 24] ^ A[S >>> 16 & 255] ^ D[w >>> 8 & 255] ^ W[z & 255] ^ C[q++];
              S = X, w = Z, z = Y, L = R;
            }
            var X = (B[S >>> 24] << 24 | B[w >>> 16 & 255] << 16 | B[z >>> 8 & 255] << 8 | B[L & 255]) ^ C[q++], Z = (B[w >>> 24] << 24 | B[z >>> 16 & 255] << 16 | B[L >>> 8 & 255] << 8 | B[S & 255]) ^ C[q++], Y = (B[z >>> 24] << 24 | B[L >>> 16 & 255] << 16 | B[S >>> 8 & 255] << 8 | B[w & 255]) ^ C[q++], R = (B[L >>> 24] << 24 | B[S >>> 16 & 255] << 16 | B[w >>> 8 & 255] << 8 | B[z & 255]) ^ C[q++];
            l[f] = X, l[f + 1] = Z, l[f + 2] = Y, l[f + 3] = R;
          },
          keySize: 256 / 32
        });
        e.AES = a._createHelper(n);
      }(), i.AES;
    });
  }(Xe)), Xe.exports;
}
var Ye = { exports: {} }, Lr;
function Kt() {
  return Lr || (Lr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), P0(), H0(), D0(), n0());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.WordArray, b = x.BlockCipher, u = e.algo, v = [
          57,
          49,
          41,
          33,
          25,
          17,
          9,
          1,
          58,
          50,
          42,
          34,
          26,
          18,
          10,
          2,
          59,
          51,
          43,
          35,
          27,
          19,
          11,
          3,
          60,
          52,
          44,
          36,
          63,
          55,
          47,
          39,
          31,
          23,
          15,
          7,
          62,
          54,
          46,
          38,
          30,
          22,
          14,
          6,
          61,
          53,
          45,
          37,
          29,
          21,
          13,
          5,
          28,
          20,
          12,
          4
        ], r = [
          14,
          17,
          11,
          24,
          1,
          5,
          3,
          28,
          15,
          6,
          21,
          10,
          23,
          19,
          12,
          4,
          26,
          8,
          16,
          7,
          27,
          20,
          13,
          2,
          41,
          52,
          31,
          37,
          47,
          55,
          30,
          40,
          51,
          45,
          33,
          48,
          44,
          49,
          39,
          56,
          34,
          53,
          46,
          42,
          50,
          36,
          29,
          32
        ], t = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28], E = [
          {
            0: 8421888,
            268435456: 32768,
            536870912: 8421378,
            805306368: 2,
            1073741824: 512,
            1342177280: 8421890,
            1610612736: 8389122,
            1879048192: 8388608,
            2147483648: 514,
            2415919104: 8389120,
            2684354560: 33280,
            2952790016: 8421376,
            3221225472: 32770,
            3489660928: 8388610,
            3758096384: 0,
            4026531840: 33282,
            134217728: 0,
            402653184: 8421890,
            671088640: 33282,
            939524096: 32768,
            1207959552: 8421888,
            1476395008: 512,
            1744830464: 8421378,
            2013265920: 2,
            2281701376: 8389120,
            2550136832: 33280,
            2818572288: 8421376,
            3087007744: 8389122,
            3355443200: 8388610,
            3623878656: 32770,
            3892314112: 514,
            4160749568: 8388608,
            1: 32768,
            268435457: 2,
            536870913: 8421888,
            805306369: 8388608,
            1073741825: 8421378,
            1342177281: 33280,
            1610612737: 512,
            1879048193: 8389122,
            2147483649: 8421890,
            2415919105: 8421376,
            2684354561: 8388610,
            2952790017: 33282,
            3221225473: 514,
            3489660929: 8389120,
            3758096385: 32770,
            4026531841: 0,
            134217729: 8421890,
            402653185: 8421376,
            671088641: 8388608,
            939524097: 512,
            1207959553: 32768,
            1476395009: 8388610,
            1744830465: 2,
            2013265921: 33282,
            2281701377: 32770,
            2550136833: 8389122,
            2818572289: 514,
            3087007745: 8421888,
            3355443201: 8389120,
            3623878657: 0,
            3892314113: 33280,
            4160749569: 8421378
          },
          {
            0: 1074282512,
            16777216: 16384,
            33554432: 524288,
            50331648: 1074266128,
            67108864: 1073741840,
            83886080: 1074282496,
            100663296: 1073758208,
            117440512: 16,
            134217728: 540672,
            150994944: 1073758224,
            167772160: 1073741824,
            184549376: 540688,
            201326592: 524304,
            218103808: 0,
            234881024: 16400,
            251658240: 1074266112,
            8388608: 1073758208,
            25165824: 540688,
            41943040: 16,
            58720256: 1073758224,
            75497472: 1074282512,
            92274688: 1073741824,
            109051904: 524288,
            125829120: 1074266128,
            142606336: 524304,
            159383552: 0,
            176160768: 16384,
            192937984: 1074266112,
            209715200: 1073741840,
            226492416: 540672,
            243269632: 1074282496,
            260046848: 16400,
            268435456: 0,
            285212672: 1074266128,
            301989888: 1073758224,
            318767104: 1074282496,
            335544320: 1074266112,
            352321536: 16,
            369098752: 540688,
            385875968: 16384,
            402653184: 16400,
            419430400: 524288,
            436207616: 524304,
            452984832: 1073741840,
            469762048: 540672,
            486539264: 1073758208,
            503316480: 1073741824,
            520093696: 1074282512,
            276824064: 540688,
            293601280: 524288,
            310378496: 1074266112,
            327155712: 16384,
            343932928: 1073758208,
            360710144: 1074282512,
            377487360: 16,
            394264576: 1073741824,
            411041792: 1074282496,
            427819008: 1073741840,
            444596224: 1073758224,
            461373440: 524304,
            478150656: 0,
            494927872: 16400,
            511705088: 1074266128,
            528482304: 540672
          },
          {
            0: 260,
            1048576: 0,
            2097152: 67109120,
            3145728: 65796,
            4194304: 65540,
            5242880: 67108868,
            6291456: 67174660,
            7340032: 67174400,
            8388608: 67108864,
            9437184: 67174656,
            10485760: 65792,
            11534336: 67174404,
            12582912: 67109124,
            13631488: 65536,
            14680064: 4,
            15728640: 256,
            524288: 67174656,
            1572864: 67174404,
            2621440: 0,
            3670016: 67109120,
            4718592: 67108868,
            5767168: 65536,
            6815744: 65540,
            7864320: 260,
            8912896: 4,
            9961472: 256,
            11010048: 67174400,
            12058624: 65796,
            13107200: 65792,
            14155776: 67109124,
            15204352: 67174660,
            16252928: 67108864,
            16777216: 67174656,
            17825792: 65540,
            18874368: 65536,
            19922944: 67109120,
            20971520: 256,
            22020096: 67174660,
            23068672: 67108868,
            24117248: 0,
            25165824: 67109124,
            26214400: 67108864,
            27262976: 4,
            28311552: 65792,
            29360128: 67174400,
            30408704: 260,
            31457280: 65796,
            32505856: 67174404,
            17301504: 67108864,
            18350080: 260,
            19398656: 67174656,
            20447232: 0,
            21495808: 65540,
            22544384: 67109120,
            23592960: 256,
            24641536: 67174404,
            25690112: 65536,
            26738688: 67174660,
            27787264: 65796,
            28835840: 67108868,
            29884416: 67109124,
            30932992: 67174400,
            31981568: 4,
            33030144: 65792
          },
          {
            0: 2151682048,
            65536: 2147487808,
            131072: 4198464,
            196608: 2151677952,
            262144: 0,
            327680: 4198400,
            393216: 2147483712,
            458752: 4194368,
            524288: 2147483648,
            589824: 4194304,
            655360: 64,
            720896: 2147487744,
            786432: 2151678016,
            851968: 4160,
            917504: 4096,
            983040: 2151682112,
            32768: 2147487808,
            98304: 64,
            163840: 2151678016,
            229376: 2147487744,
            294912: 4198400,
            360448: 2151682112,
            425984: 0,
            491520: 2151677952,
            557056: 4096,
            622592: 2151682048,
            688128: 4194304,
            753664: 4160,
            819200: 2147483648,
            884736: 4194368,
            950272: 4198464,
            1015808: 2147483712,
            1048576: 4194368,
            1114112: 4198400,
            1179648: 2147483712,
            1245184: 0,
            1310720: 4160,
            1376256: 2151678016,
            1441792: 2151682048,
            1507328: 2147487808,
            1572864: 2151682112,
            1638400: 2147483648,
            1703936: 2151677952,
            1769472: 4198464,
            1835008: 2147487744,
            1900544: 4194304,
            1966080: 64,
            2031616: 4096,
            1081344: 2151677952,
            1146880: 2151682112,
            1212416: 0,
            1277952: 4198400,
            1343488: 4194368,
            1409024: 2147483648,
            1474560: 2147487808,
            1540096: 64,
            1605632: 2147483712,
            1671168: 4096,
            1736704: 2147487744,
            1802240: 2151678016,
            1867776: 4160,
            1933312: 2151682048,
            1998848: 4194304,
            2064384: 4198464
          },
          {
            0: 128,
            4096: 17039360,
            8192: 262144,
            12288: 536870912,
            16384: 537133184,
            20480: 16777344,
            24576: 553648256,
            28672: 262272,
            32768: 16777216,
            36864: 537133056,
            40960: 536871040,
            45056: 553910400,
            49152: 553910272,
            53248: 0,
            57344: 17039488,
            61440: 553648128,
            2048: 17039488,
            6144: 553648256,
            10240: 128,
            14336: 17039360,
            18432: 262144,
            22528: 537133184,
            26624: 553910272,
            30720: 536870912,
            34816: 537133056,
            38912: 0,
            43008: 553910400,
            47104: 16777344,
            51200: 536871040,
            55296: 553648128,
            59392: 16777216,
            63488: 262272,
            65536: 262144,
            69632: 128,
            73728: 536870912,
            77824: 553648256,
            81920: 16777344,
            86016: 553910272,
            90112: 537133184,
            94208: 16777216,
            98304: 553910400,
            102400: 553648128,
            106496: 17039360,
            110592: 537133056,
            114688: 262272,
            118784: 536871040,
            122880: 0,
            126976: 17039488,
            67584: 553648256,
            71680: 16777216,
            75776: 17039360,
            79872: 537133184,
            83968: 536870912,
            88064: 17039488,
            92160: 128,
            96256: 553910272,
            100352: 262272,
            104448: 553910400,
            108544: 0,
            112640: 553648128,
            116736: 16777344,
            120832: 262144,
            124928: 537133056,
            129024: 536871040
          },
          {
            0: 268435464,
            256: 8192,
            512: 270532608,
            768: 270540808,
            1024: 268443648,
            1280: 2097152,
            1536: 2097160,
            1792: 268435456,
            2048: 0,
            2304: 268443656,
            2560: 2105344,
            2816: 8,
            3072: 270532616,
            3328: 2105352,
            3584: 8200,
            3840: 270540800,
            128: 270532608,
            384: 270540808,
            640: 8,
            896: 2097152,
            1152: 2105352,
            1408: 268435464,
            1664: 268443648,
            1920: 8200,
            2176: 2097160,
            2432: 8192,
            2688: 268443656,
            2944: 270532616,
            3200: 0,
            3456: 270540800,
            3712: 2105344,
            3968: 268435456,
            4096: 268443648,
            4352: 270532616,
            4608: 270540808,
            4864: 8200,
            5120: 2097152,
            5376: 268435456,
            5632: 268435464,
            5888: 2105344,
            6144: 2105352,
            6400: 0,
            6656: 8,
            6912: 270532608,
            7168: 8192,
            7424: 268443656,
            7680: 270540800,
            7936: 2097160,
            4224: 8,
            4480: 2105344,
            4736: 2097152,
            4992: 268435464,
            5248: 268443648,
            5504: 8200,
            5760: 270540808,
            6016: 270532608,
            6272: 270540800,
            6528: 270532616,
            6784: 8192,
            7040: 2105352,
            7296: 2097160,
            7552: 0,
            7808: 268435456,
            8064: 268443656
          },
          {
            0: 1048576,
            16: 33555457,
            32: 1024,
            48: 1049601,
            64: 34604033,
            80: 0,
            96: 1,
            112: 34603009,
            128: 33555456,
            144: 1048577,
            160: 33554433,
            176: 34604032,
            192: 34603008,
            208: 1025,
            224: 1049600,
            240: 33554432,
            8: 34603009,
            24: 0,
            40: 33555457,
            56: 34604032,
            72: 1048576,
            88: 33554433,
            104: 33554432,
            120: 1025,
            136: 1049601,
            152: 33555456,
            168: 34603008,
            184: 1048577,
            200: 1024,
            216: 34604033,
            232: 1,
            248: 1049600,
            256: 33554432,
            272: 1048576,
            288: 33555457,
            304: 34603009,
            320: 1048577,
            336: 33555456,
            352: 34604032,
            368: 1049601,
            384: 1025,
            400: 34604033,
            416: 1049600,
            432: 1,
            448: 0,
            464: 34603008,
            480: 33554433,
            496: 1024,
            264: 1049600,
            280: 33555457,
            296: 34603009,
            312: 1,
            328: 33554432,
            344: 1048576,
            360: 1025,
            376: 34604032,
            392: 33554433,
            408: 34603008,
            424: 0,
            440: 34604033,
            456: 1049601,
            472: 1024,
            488: 33555456,
            504: 1048577
          },
          {
            0: 134219808,
            1: 131072,
            2: 134217728,
            3: 32,
            4: 131104,
            5: 134350880,
            6: 134350848,
            7: 2048,
            8: 134348800,
            9: 134219776,
            10: 133120,
            11: 134348832,
            12: 2080,
            13: 0,
            14: 134217760,
            15: 133152,
            2147483648: 2048,
            2147483649: 134350880,
            2147483650: 134219808,
            2147483651: 134217728,
            2147483652: 134348800,
            2147483653: 133120,
            2147483654: 133152,
            2147483655: 32,
            2147483656: 134217760,
            2147483657: 2080,
            2147483658: 131104,
            2147483659: 134350848,
            2147483660: 0,
            2147483661: 134348832,
            2147483662: 134219776,
            2147483663: 131072,
            16: 133152,
            17: 134350848,
            18: 32,
            19: 2048,
            20: 134219776,
            21: 134217760,
            22: 134348832,
            23: 131072,
            24: 0,
            25: 131104,
            26: 134348800,
            27: 134219808,
            28: 134350880,
            29: 133120,
            30: 2080,
            31: 134217728,
            2147483664: 131072,
            2147483665: 2048,
            2147483666: 134348832,
            2147483667: 133152,
            2147483668: 32,
            2147483669: 134348800,
            2147483670: 134217728,
            2147483671: 134219808,
            2147483672: 134350880,
            2147483673: 134217760,
            2147483674: 134219776,
            2147483675: 0,
            2147483676: 133120,
            2147483677: 2080,
            2147483678: 131104,
            2147483679: 134350848
          }
        ], o = [
          4160749569,
          528482304,
          33030144,
          2064384,
          129024,
          8064,
          504,
          2147483679
        ], h = u.DES = b.extend({
          _doReset: function() {
            for (var y = this._key, n = y.words, l = [], f = 0; f < 56; f++) {
              var C = v[f] - 1;
              l[f] = n[C >>> 5] >>> 31 - C % 32 & 1;
            }
            for (var _ = this._subKeys = [], A = 0; A < 16; A++) {
              for (var D = _[A] = [], W = t[A], f = 0; f < 24; f++)
                D[f / 6 | 0] |= l[(r[f] - 1 + W) % 28] << 31 - f % 6, D[4 + (f / 6 | 0)] |= l[28 + (r[f + 24] - 1 + W) % 28] << 31 - f % 6;
              D[0] = D[0] << 1 | D[0] >>> 31;
              for (var f = 1; f < 7; f++)
                D[f] = D[f] >>> (f - 1) * 4 + 3;
              D[7] = D[7] << 5 | D[7] >>> 27;
            }
            for (var B = this._invSubKeys = [], f = 0; f < 16; f++)
              B[f] = _[15 - f];
          },
          encryptBlock: function(y, n) {
            this._doCryptBlock(y, n, this._subKeys);
          },
          decryptBlock: function(y, n) {
            this._doCryptBlock(y, n, this._invSubKeys);
          },
          _doCryptBlock: function(y, n, l) {
            this._lBlock = y[n], this._rBlock = y[n + 1], s.call(this, 4, 252645135), s.call(this, 16, 65535), d.call(this, 2, 858993459), d.call(this, 8, 16711935), s.call(this, 1, 1431655765);
            for (var f = 0; f < 16; f++) {
              for (var C = l[f], _ = this._lBlock, A = this._rBlock, D = 0, W = 0; W < 8; W++)
                D |= E[W][((A ^ C[W]) & o[W]) >>> 0];
              this._lBlock = A, this._rBlock = _ ^ D;
            }
            var B = this._lBlock;
            this._lBlock = this._rBlock, this._rBlock = B, s.call(this, 1, 1431655765), d.call(this, 8, 16711935), d.call(this, 2, 858993459), s.call(this, 16, 65535), s.call(this, 4, 252645135), y[n] = this._lBlock, y[n + 1] = this._rBlock;
          },
          keySize: 64 / 32,
          ivSize: 64 / 32,
          blockSize: 64 / 32
        });
        function s(y, n) {
          var l = (this._lBlock >>> y ^ this._rBlock) & n;
          this._rBlock ^= l, this._lBlock ^= l << y;
        }
        function d(y, n) {
          var l = (this._rBlock >>> y ^ this._lBlock) & n;
          this._lBlock ^= l, this._rBlock ^= l << y;
        }
        e.DES = b._createHelper(h);
        var c = u.TripleDES = b.extend({
          _doReset: function() {
            var y = this._key, n = y.words;
            if (n.length !== 2 && n.length !== 4 && n.length < 6)
              throw new Error("Invalid key length - 3DES requires the key length to be 64, 128, 192 or >192.");
            var l = n.slice(0, 2), f = n.length < 4 ? n.slice(0, 2) : n.slice(2, 4), C = n.length < 6 ? n.slice(0, 2) : n.slice(4, 6);
            this._des1 = h.createEncryptor(a.create(l)), this._des2 = h.createEncryptor(a.create(f)), this._des3 = h.createEncryptor(a.create(C));
          },
          encryptBlock: function(y, n) {
            this._des1.encryptBlock(y, n), this._des2.decryptBlock(y, n), this._des3.encryptBlock(y, n);
          },
          decryptBlock: function(y, n) {
            this._des3.decryptBlock(y, n), this._des2.encryptBlock(y, n), this._des1.decryptBlock(y, n);
          },
          keySize: 192 / 32,
          ivSize: 64 / 32,
          blockSize: 64 / 32
        });
        e.TripleDES = b._createHelper(c);
      }(), i.TripleDES;
    });
  }(Ye)), Ye.exports;
}
var Ge = { exports: {} }, Or;
function Xt() {
  return Or || (Or = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), P0(), H0(), D0(), n0());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.StreamCipher, b = e.algo, u = b.RC4 = a.extend({
          _doReset: function() {
            for (var t = this._key, E = t.words, o = t.sigBytes, h = this._S = [], s = 0; s < 256; s++)
              h[s] = s;
            for (var s = 0, d = 0; s < 256; s++) {
              var c = s % o, y = E[c >>> 2] >>> 24 - c % 4 * 8 & 255;
              d = (d + h[s] + y) % 256;
              var n = h[s];
              h[s] = h[d], h[d] = n;
            }
            this._i = this._j = 0;
          },
          _doProcessBlock: function(t, E) {
            t[E] ^= v.call(this);
          },
          keySize: 256 / 32,
          ivSize: 0
        });
        function v() {
          for (var t = this._S, E = this._i, o = this._j, h = 0, s = 0; s < 4; s++) {
            E = (E + 1) % 256, o = (o + t[E]) % 256;
            var d = t[E];
            t[E] = t[o], t[o] = d, h |= t[(t[E] + t[o]) % 256] << 24 - s * 8;
          }
          return this._i = E, this._j = o, h;
        }
        e.RC4 = a._createHelper(u);
        var r = b.RC4Drop = u.extend({
          /**
           * Configuration options.
           *
           * @property {number} drop The number of keystream words to drop. Default 192
           */
          cfg: u.cfg.extend({
            drop: 192
          }),
          _doReset: function() {
            u._doReset.call(this);
            for (var t = this.cfg.drop; t > 0; t--)
              v.call(this);
          }
        });
        e.RC4Drop = a._createHelper(r);
      }(), i.RC4;
    });
  }(Ge)), Ge.exports;
}
var Ve = { exports: {} }, Ir;
function Yt() {
  return Ir || (Ir = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), P0(), H0(), D0(), n0());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.StreamCipher, b = e.algo, u = [], v = [], r = [], t = b.Rabbit = a.extend({
          _doReset: function() {
            for (var o = this._key.words, h = this.cfg.iv, s = 0; s < 4; s++)
              o[s] = (o[s] << 8 | o[s] >>> 24) & 16711935 | (o[s] << 24 | o[s] >>> 8) & 4278255360;
            var d = this._X = [
              o[0],
              o[3] << 16 | o[2] >>> 16,
              o[1],
              o[0] << 16 | o[3] >>> 16,
              o[2],
              o[1] << 16 | o[0] >>> 16,
              o[3],
              o[2] << 16 | o[1] >>> 16
            ], c = this._C = [
              o[2] << 16 | o[2] >>> 16,
              o[0] & 4294901760 | o[1] & 65535,
              o[3] << 16 | o[3] >>> 16,
              o[1] & 4294901760 | o[2] & 65535,
              o[0] << 16 | o[0] >>> 16,
              o[2] & 4294901760 | o[3] & 65535,
              o[1] << 16 | o[1] >>> 16,
              o[3] & 4294901760 | o[0] & 65535
            ];
            this._b = 0;
            for (var s = 0; s < 4; s++)
              E.call(this);
            for (var s = 0; s < 8; s++)
              c[s] ^= d[s + 4 & 7];
            if (h) {
              var y = h.words, n = y[0], l = y[1], f = (n << 8 | n >>> 24) & 16711935 | (n << 24 | n >>> 8) & 4278255360, C = (l << 8 | l >>> 24) & 16711935 | (l << 24 | l >>> 8) & 4278255360, _ = f >>> 16 | C & 4294901760, A = C << 16 | f & 65535;
              c[0] ^= f, c[1] ^= _, c[2] ^= C, c[3] ^= A, c[4] ^= f, c[5] ^= _, c[6] ^= C, c[7] ^= A;
              for (var s = 0; s < 4; s++)
                E.call(this);
            }
          },
          _doProcessBlock: function(o, h) {
            var s = this._X;
            E.call(this), u[0] = s[0] ^ s[5] >>> 16 ^ s[3] << 16, u[1] = s[2] ^ s[7] >>> 16 ^ s[5] << 16, u[2] = s[4] ^ s[1] >>> 16 ^ s[7] << 16, u[3] = s[6] ^ s[3] >>> 16 ^ s[1] << 16;
            for (var d = 0; d < 4; d++)
              u[d] = (u[d] << 8 | u[d] >>> 24) & 16711935 | (u[d] << 24 | u[d] >>> 8) & 4278255360, o[h + d] ^= u[d];
          },
          blockSize: 128 / 32,
          ivSize: 64 / 32
        });
        function E() {
          for (var o = this._X, h = this._C, s = 0; s < 8; s++)
            v[s] = h[s];
          h[0] = h[0] + 1295307597 + this._b | 0, h[1] = h[1] + 3545052371 + (h[0] >>> 0 < v[0] >>> 0 ? 1 : 0) | 0, h[2] = h[2] + 886263092 + (h[1] >>> 0 < v[1] >>> 0 ? 1 : 0) | 0, h[3] = h[3] + 1295307597 + (h[2] >>> 0 < v[2] >>> 0 ? 1 : 0) | 0, h[4] = h[4] + 3545052371 + (h[3] >>> 0 < v[3] >>> 0 ? 1 : 0) | 0, h[5] = h[5] + 886263092 + (h[4] >>> 0 < v[4] >>> 0 ? 1 : 0) | 0, h[6] = h[6] + 1295307597 + (h[5] >>> 0 < v[5] >>> 0 ? 1 : 0) | 0, h[7] = h[7] + 3545052371 + (h[6] >>> 0 < v[6] >>> 0 ? 1 : 0) | 0, this._b = h[7] >>> 0 < v[7] >>> 0 ? 1 : 0;
          for (var s = 0; s < 8; s++) {
            var d = o[s] + h[s], c = d & 65535, y = d >>> 16, n = ((c * c >>> 17) + c * y >>> 15) + y * y, l = ((d & 4294901760) * d | 0) + ((d & 65535) * d | 0);
            r[s] = n ^ l;
          }
          o[0] = r[0] + (r[7] << 16 | r[7] >>> 16) + (r[6] << 16 | r[6] >>> 16) | 0, o[1] = r[1] + (r[0] << 8 | r[0] >>> 24) + r[7] | 0, o[2] = r[2] + (r[1] << 16 | r[1] >>> 16) + (r[0] << 16 | r[0] >>> 16) | 0, o[3] = r[3] + (r[2] << 8 | r[2] >>> 24) + r[1] | 0, o[4] = r[4] + (r[3] << 16 | r[3] >>> 16) + (r[2] << 16 | r[2] >>> 16) | 0, o[5] = r[5] + (r[4] << 8 | r[4] >>> 24) + r[3] | 0, o[6] = r[6] + (r[5] << 16 | r[5] >>> 16) + (r[4] << 16 | r[4] >>> 16) | 0, o[7] = r[7] + (r[6] << 8 | r[6] >>> 24) + r[5] | 0;
        }
        e.Rabbit = a._createHelper(t);
      }(), i.Rabbit;
    });
  }(Ve)), Ve.exports;
}
var Ze = { exports: {} }, qr;
function Gt() {
  return qr || (qr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), P0(), H0(), D0(), n0());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.StreamCipher, b = e.algo, u = [], v = [], r = [], t = b.RabbitLegacy = a.extend({
          _doReset: function() {
            var o = this._key.words, h = this.cfg.iv, s = this._X = [
              o[0],
              o[3] << 16 | o[2] >>> 16,
              o[1],
              o[0] << 16 | o[3] >>> 16,
              o[2],
              o[1] << 16 | o[0] >>> 16,
              o[3],
              o[2] << 16 | o[1] >>> 16
            ], d = this._C = [
              o[2] << 16 | o[2] >>> 16,
              o[0] & 4294901760 | o[1] & 65535,
              o[3] << 16 | o[3] >>> 16,
              o[1] & 4294901760 | o[2] & 65535,
              o[0] << 16 | o[0] >>> 16,
              o[2] & 4294901760 | o[3] & 65535,
              o[1] << 16 | o[1] >>> 16,
              o[3] & 4294901760 | o[0] & 65535
            ];
            this._b = 0;
            for (var c = 0; c < 4; c++)
              E.call(this);
            for (var c = 0; c < 8; c++)
              d[c] ^= s[c + 4 & 7];
            if (h) {
              var y = h.words, n = y[0], l = y[1], f = (n << 8 | n >>> 24) & 16711935 | (n << 24 | n >>> 8) & 4278255360, C = (l << 8 | l >>> 24) & 16711935 | (l << 24 | l >>> 8) & 4278255360, _ = f >>> 16 | C & 4294901760, A = C << 16 | f & 65535;
              d[0] ^= f, d[1] ^= _, d[2] ^= C, d[3] ^= A, d[4] ^= f, d[5] ^= _, d[6] ^= C, d[7] ^= A;
              for (var c = 0; c < 4; c++)
                E.call(this);
            }
          },
          _doProcessBlock: function(o, h) {
            var s = this._X;
            E.call(this), u[0] = s[0] ^ s[5] >>> 16 ^ s[3] << 16, u[1] = s[2] ^ s[7] >>> 16 ^ s[5] << 16, u[2] = s[4] ^ s[1] >>> 16 ^ s[7] << 16, u[3] = s[6] ^ s[3] >>> 16 ^ s[1] << 16;
            for (var d = 0; d < 4; d++)
              u[d] = (u[d] << 8 | u[d] >>> 24) & 16711935 | (u[d] << 24 | u[d] >>> 8) & 4278255360, o[h + d] ^= u[d];
          },
          blockSize: 128 / 32,
          ivSize: 64 / 32
        });
        function E() {
          for (var o = this._X, h = this._C, s = 0; s < 8; s++)
            v[s] = h[s];
          h[0] = h[0] + 1295307597 + this._b | 0, h[1] = h[1] + 3545052371 + (h[0] >>> 0 < v[0] >>> 0 ? 1 : 0) | 0, h[2] = h[2] + 886263092 + (h[1] >>> 0 < v[1] >>> 0 ? 1 : 0) | 0, h[3] = h[3] + 1295307597 + (h[2] >>> 0 < v[2] >>> 0 ? 1 : 0) | 0, h[4] = h[4] + 3545052371 + (h[3] >>> 0 < v[3] >>> 0 ? 1 : 0) | 0, h[5] = h[5] + 886263092 + (h[4] >>> 0 < v[4] >>> 0 ? 1 : 0) | 0, h[6] = h[6] + 1295307597 + (h[5] >>> 0 < v[5] >>> 0 ? 1 : 0) | 0, h[7] = h[7] + 3545052371 + (h[6] >>> 0 < v[6] >>> 0 ? 1 : 0) | 0, this._b = h[7] >>> 0 < v[7] >>> 0 ? 1 : 0;
          for (var s = 0; s < 8; s++) {
            var d = o[s] + h[s], c = d & 65535, y = d >>> 16, n = ((c * c >>> 17) + c * y >>> 15) + y * y, l = ((d & 4294901760) * d | 0) + ((d & 65535) * d | 0);
            r[s] = n ^ l;
          }
          o[0] = r[0] + (r[7] << 16 | r[7] >>> 16) + (r[6] << 16 | r[6] >>> 16) | 0, o[1] = r[1] + (r[0] << 8 | r[0] >>> 24) + r[7] | 0, o[2] = r[2] + (r[1] << 16 | r[1] >>> 16) + (r[0] << 16 | r[0] >>> 16) | 0, o[3] = r[3] + (r[2] << 8 | r[2] >>> 24) + r[1] | 0, o[4] = r[4] + (r[3] << 16 | r[3] >>> 16) + (r[2] << 16 | r[2] >>> 16) | 0, o[5] = r[5] + (r[4] << 8 | r[4] >>> 24) + r[3] | 0, o[6] = r[6] + (r[5] << 16 | r[5] >>> 16) + (r[4] << 16 | r[4] >>> 16) | 0, o[7] = r[7] + (r[6] << 8 | r[6] >>> 24) + r[5] | 0;
        }
        e.RabbitLegacy = a._createHelper(t);
      }(), i.RabbitLegacy;
    });
  }(Ze)), Ze.exports;
}
var Qe = { exports: {} }, Mr;
function Vt() {
  return Mr || (Mr = 1, function(m, F) {
    (function(i, e, x) {
      m.exports = e(U(), P0(), H0(), D0(), n0());
    })(M, function(i) {
      return function() {
        var e = i, x = e.lib, a = x.BlockCipher, b = e.algo;
        const u = 16, v = [
          608135816,
          2242054355,
          320440878,
          57701188,
          2752067618,
          698298832,
          137296536,
          3964562569,
          1160258022,
          953160567,
          3193202383,
          887688300,
          3232508343,
          3380367581,
          1065670069,
          3041331479,
          2450970073,
          2306472731
        ], r = [
          [
            3509652390,
            2564797868,
            805139163,
            3491422135,
            3101798381,
            1780907670,
            3128725573,
            4046225305,
            614570311,
            3012652279,
            134345442,
            2240740374,
            1667834072,
            1901547113,
            2757295779,
            4103290238,
            227898511,
            1921955416,
            1904987480,
            2182433518,
            2069144605,
            3260701109,
            2620446009,
            720527379,
            3318853667,
            677414384,
            3393288472,
            3101374703,
            2390351024,
            1614419982,
            1822297739,
            2954791486,
            3608508353,
            3174124327,
            2024746970,
            1432378464,
            3864339955,
            2857741204,
            1464375394,
            1676153920,
            1439316330,
            715854006,
            3033291828,
            289532110,
            2706671279,
            2087905683,
            3018724369,
            1668267050,
            732546397,
            1947742710,
            3462151702,
            2609353502,
            2950085171,
            1814351708,
            2050118529,
            680887927,
            999245976,
            1800124847,
            3300911131,
            1713906067,
            1641548236,
            4213287313,
            1216130144,
            1575780402,
            4018429277,
            3917837745,
            3693486850,
            3949271944,
            596196993,
            3549867205,
            258830323,
            2213823033,
            772490370,
            2760122372,
            1774776394,
            2652871518,
            566650946,
            4142492826,
            1728879713,
            2882767088,
            1783734482,
            3629395816,
            2517608232,
            2874225571,
            1861159788,
            326777828,
            3124490320,
            2130389656,
            2716951837,
            967770486,
            1724537150,
            2185432712,
            2364442137,
            1164943284,
            2105845187,
            998989502,
            3765401048,
            2244026483,
            1075463327,
            1455516326,
            1322494562,
            910128902,
            469688178,
            1117454909,
            936433444,
            3490320968,
            3675253459,
            1240580251,
            122909385,
            2157517691,
            634681816,
            4142456567,
            3825094682,
            3061402683,
            2540495037,
            79693498,
            3249098678,
            1084186820,
            1583128258,
            426386531,
            1761308591,
            1047286709,
            322548459,
            995290223,
            1845252383,
            2603652396,
            3431023940,
            2942221577,
            3202600964,
            3727903485,
            1712269319,
            422464435,
            3234572375,
            1170764815,
            3523960633,
            3117677531,
            1434042557,
            442511882,
            3600875718,
            1076654713,
            1738483198,
            4213154764,
            2393238008,
            3677496056,
            1014306527,
            4251020053,
            793779912,
            2902807211,
            842905082,
            4246964064,
            1395751752,
            1040244610,
            2656851899,
            3396308128,
            445077038,
            3742853595,
            3577915638,
            679411651,
            2892444358,
            2354009459,
            1767581616,
            3150600392,
            3791627101,
            3102740896,
            284835224,
            4246832056,
            1258075500,
            768725851,
            2589189241,
            3069724005,
            3532540348,
            1274779536,
            3789419226,
            2764799539,
            1660621633,
            3471099624,
            4011903706,
            913787905,
            3497959166,
            737222580,
            2514213453,
            2928710040,
            3937242737,
            1804850592,
            3499020752,
            2949064160,
            2386320175,
            2390070455,
            2415321851,
            4061277028,
            2290661394,
            2416832540,
            1336762016,
            1754252060,
            3520065937,
            3014181293,
            791618072,
            3188594551,
            3933548030,
            2332172193,
            3852520463,
            3043980520,
            413987798,
            3465142937,
            3030929376,
            4245938359,
            2093235073,
            3534596313,
            375366246,
            2157278981,
            2479649556,
            555357303,
            3870105701,
            2008414854,
            3344188149,
            4221384143,
            3956125452,
            2067696032,
            3594591187,
            2921233993,
            2428461,
            544322398,
            577241275,
            1471733935,
            610547355,
            4027169054,
            1432588573,
            1507829418,
            2025931657,
            3646575487,
            545086370,
            48609733,
            2200306550,
            1653985193,
            298326376,
            1316178497,
            3007786442,
            2064951626,
            458293330,
            2589141269,
            3591329599,
            3164325604,
            727753846,
            2179363840,
            146436021,
            1461446943,
            4069977195,
            705550613,
            3059967265,
            3887724982,
            4281599278,
            3313849956,
            1404054877,
            2845806497,
            146425753,
            1854211946
          ],
          [
            1266315497,
            3048417604,
            3681880366,
            3289982499,
            290971e4,
            1235738493,
            2632868024,
            2414719590,
            3970600049,
            1771706367,
            1449415276,
            3266420449,
            422970021,
            1963543593,
            2690192192,
            3826793022,
            1062508698,
            1531092325,
            1804592342,
            2583117782,
            2714934279,
            4024971509,
            1294809318,
            4028980673,
            1289560198,
            2221992742,
            1669523910,
            35572830,
            157838143,
            1052438473,
            1016535060,
            1802137761,
            1753167236,
            1386275462,
            3080475397,
            2857371447,
            1040679964,
            2145300060,
            2390574316,
            1461121720,
            2956646967,
            4031777805,
            4028374788,
            33600511,
            2920084762,
            1018524850,
            629373528,
            3691585981,
            3515945977,
            2091462646,
            2486323059,
            586499841,
            988145025,
            935516892,
            3367335476,
            2599673255,
            2839830854,
            265290510,
            3972581182,
            2759138881,
            3795373465,
            1005194799,
            847297441,
            406762289,
            1314163512,
            1332590856,
            1866599683,
            4127851711,
            750260880,
            613907577,
            1450815602,
            3165620655,
            3734664991,
            3650291728,
            3012275730,
            3704569646,
            1427272223,
            778793252,
            1343938022,
            2676280711,
            2052605720,
            1946737175,
            3164576444,
            3914038668,
            3967478842,
            3682934266,
            1661551462,
            3294938066,
            4011595847,
            840292616,
            3712170807,
            616741398,
            312560963,
            711312465,
            1351876610,
            322626781,
            1910503582,
            271666773,
            2175563734,
            1594956187,
            70604529,
            3617834859,
            1007753275,
            1495573769,
            4069517037,
            2549218298,
            2663038764,
            504708206,
            2263041392,
            3941167025,
            2249088522,
            1514023603,
            1998579484,
            1312622330,
            694541497,
            2582060303,
            2151582166,
            1382467621,
            776784248,
            2618340202,
            3323268794,
            2497899128,
            2784771155,
            503983604,
            4076293799,
            907881277,
            423175695,
            432175456,
            1378068232,
            4145222326,
            3954048622,
            3938656102,
            3820766613,
            2793130115,
            2977904593,
            26017576,
            3274890735,
            3194772133,
            1700274565,
            1756076034,
            4006520079,
            3677328699,
            720338349,
            1533947780,
            354530856,
            688349552,
            3973924725,
            1637815568,
            332179504,
            3949051286,
            53804574,
            2852348879,
            3044236432,
            1282449977,
            3583942155,
            3416972820,
            4006381244,
            1617046695,
            2628476075,
            3002303598,
            1686838959,
            431878346,
            2686675385,
            1700445008,
            1080580658,
            1009431731,
            832498133,
            3223435511,
            2605976345,
            2271191193,
            2516031870,
            1648197032,
            4164389018,
            2548247927,
            300782431,
            375919233,
            238389289,
            3353747414,
            2531188641,
            2019080857,
            1475708069,
            455242339,
            2609103871,
            448939670,
            3451063019,
            1395535956,
            2413381860,
            1841049896,
            1491858159,
            885456874,
            4264095073,
            4001119347,
            1565136089,
            3898914787,
            1108368660,
            540939232,
            1173283510,
            2745871338,
            3681308437,
            4207628240,
            3343053890,
            4016749493,
            1699691293,
            1103962373,
            3625875870,
            2256883143,
            3830138730,
            1031889488,
            3479347698,
            1535977030,
            4236805024,
            3251091107,
            2132092099,
            1774941330,
            1199868427,
            1452454533,
            157007616,
            2904115357,
            342012276,
            595725824,
            1480756522,
            206960106,
            497939518,
            591360097,
            863170706,
            2375253569,
            3596610801,
            1814182875,
            2094937945,
            3421402208,
            1082520231,
            3463918190,
            2785509508,
            435703966,
            3908032597,
            1641649973,
            2842273706,
            3305899714,
            1510255612,
            2148256476,
            2655287854,
            3276092548,
            4258621189,
            236887753,
            3681803219,
            274041037,
            1734335097,
            3815195456,
            3317970021,
            1899903192,
            1026095262,
            4050517792,
            356393447,
            2410691914,
            3873677099,
            3682840055
          ],
          [
            3913112168,
            2491498743,
            4132185628,
            2489919796,
            1091903735,
            1979897079,
            3170134830,
            3567386728,
            3557303409,
            857797738,
            1136121015,
            1342202287,
            507115054,
            2535736646,
            337727348,
            3213592640,
            1301675037,
            2528481711,
            1895095763,
            1721773893,
            3216771564,
            62756741,
            2142006736,
            835421444,
            2531993523,
            1442658625,
            3659876326,
            2882144922,
            676362277,
            1392781812,
            170690266,
            3921047035,
            1759253602,
            3611846912,
            1745797284,
            664899054,
            1329594018,
            3901205900,
            3045908486,
            2062866102,
            2865634940,
            3543621612,
            3464012697,
            1080764994,
            553557557,
            3656615353,
            3996768171,
            991055499,
            499776247,
            1265440854,
            648242737,
            3940784050,
            980351604,
            3713745714,
            1749149687,
            3396870395,
            4211799374,
            3640570775,
            1161844396,
            3125318951,
            1431517754,
            545492359,
            4268468663,
            3499529547,
            1437099964,
            2702547544,
            3433638243,
            2581715763,
            2787789398,
            1060185593,
            1593081372,
            2418618748,
            4260947970,
            69676912,
            2159744348,
            86519011,
            2512459080,
            3838209314,
            1220612927,
            3339683548,
            133810670,
            1090789135,
            1078426020,
            1569222167,
            845107691,
            3583754449,
            4072456591,
            1091646820,
            628848692,
            1613405280,
            3757631651,
            526609435,
            236106946,
            48312990,
            2942717905,
            3402727701,
            1797494240,
            859738849,
            992217954,
            4005476642,
            2243076622,
            3870952857,
            3732016268,
            765654824,
            3490871365,
            2511836413,
            1685915746,
            3888969200,
            1414112111,
            2273134842,
            3281911079,
            4080962846,
            172450625,
            2569994100,
            980381355,
            4109958455,
            2819808352,
            2716589560,
            2568741196,
            3681446669,
            3329971472,
            1835478071,
            660984891,
            3704678404,
            4045999559,
            3422617507,
            3040415634,
            1762651403,
            1719377915,
            3470491036,
            2693910283,
            3642056355,
            3138596744,
            1364962596,
            2073328063,
            1983633131,
            926494387,
            3423689081,
            2150032023,
            4096667949,
            1749200295,
            3328846651,
            309677260,
            2016342300,
            1779581495,
            3079819751,
            111262694,
            1274766160,
            443224088,
            298511866,
            1025883608,
            3806446537,
            1145181785,
            168956806,
            3641502830,
            3584813610,
            1689216846,
            3666258015,
            3200248200,
            1692713982,
            2646376535,
            4042768518,
            1618508792,
            1610833997,
            3523052358,
            4130873264,
            2001055236,
            3610705100,
            2202168115,
            4028541809,
            2961195399,
            1006657119,
            2006996926,
            3186142756,
            1430667929,
            3210227297,
            1314452623,
            4074634658,
            4101304120,
            2273951170,
            1399257539,
            3367210612,
            3027628629,
            1190975929,
            2062231137,
            2333990788,
            2221543033,
            2438960610,
            1181637006,
            548689776,
            2362791313,
            3372408396,
            3104550113,
            3145860560,
            296247880,
            1970579870,
            3078560182,
            3769228297,
            1714227617,
            3291629107,
            3898220290,
            166772364,
            1251581989,
            493813264,
            448347421,
            195405023,
            2709975567,
            677966185,
            3703036547,
            1463355134,
            2715995803,
            1338867538,
            1343315457,
            2802222074,
            2684532164,
            233230375,
            2599980071,
            2000651841,
            3277868038,
            1638401717,
            4028070440,
            3237316320,
            6314154,
            819756386,
            300326615,
            590932579,
            1405279636,
            3267499572,
            3150704214,
            2428286686,
            3959192993,
            3461946742,
            1862657033,
            1266418056,
            963775037,
            2089974820,
            2263052895,
            1917689273,
            448879540,
            3550394620,
            3981727096,
            150775221,
            3627908307,
            1303187396,
            508620638,
            2975983352,
            2726630617,
            1817252668,
            1876281319,
            1457606340,
            908771278,
            3720792119,
            3617206836,
            2455994898,
            1729034894,
            1080033504
          ],
          [
            976866871,
            3556439503,
            2881648439,
            1522871579,
            1555064734,
            1336096578,
            3548522304,
            2579274686,
            3574697629,
            3205460757,
            3593280638,
            3338716283,
            3079412587,
            564236357,
            2993598910,
            1781952180,
            1464380207,
            3163844217,
            3332601554,
            1699332808,
            1393555694,
            1183702653,
            3581086237,
            1288719814,
            691649499,
            2847557200,
            2895455976,
            3193889540,
            2717570544,
            1781354906,
            1676643554,
            2592534050,
            3230253752,
            1126444790,
            2770207658,
            2633158820,
            2210423226,
            2615765581,
            2414155088,
            3127139286,
            673620729,
            2805611233,
            1269405062,
            4015350505,
            3341807571,
            4149409754,
            1057255273,
            2012875353,
            2162469141,
            2276492801,
            2601117357,
            993977747,
            3918593370,
            2654263191,
            753973209,
            36408145,
            2530585658,
            25011837,
            3520020182,
            2088578344,
            530523599,
            2918365339,
            1524020338,
            1518925132,
            3760827505,
            3759777254,
            1202760957,
            3985898139,
            3906192525,
            674977740,
            4174734889,
            2031300136,
            2019492241,
            3983892565,
            4153806404,
            3822280332,
            352677332,
            2297720250,
            60907813,
            90501309,
            3286998549,
            1016092578,
            2535922412,
            2839152426,
            457141659,
            509813237,
            4120667899,
            652014361,
            1966332200,
            2975202805,
            55981186,
            2327461051,
            676427537,
            3255491064,
            2882294119,
            3433927263,
            1307055953,
            942726286,
            933058658,
            2468411793,
            3933900994,
            4215176142,
            1361170020,
            2001714738,
            2830558078,
            3274259782,
            1222529897,
            1679025792,
            2729314320,
            3714953764,
            1770335741,
            151462246,
            3013232138,
            1682292957,
            1483529935,
            471910574,
            1539241949,
            458788160,
            3436315007,
            1807016891,
            3718408830,
            978976581,
            1043663428,
            3165965781,
            1927990952,
            4200891579,
            2372276910,
            3208408903,
            3533431907,
            1412390302,
            2931980059,
            4132332400,
            1947078029,
            3881505623,
            4168226417,
            2941484381,
            1077988104,
            1320477388,
            886195818,
            18198404,
            3786409e3,
            2509781533,
            112762804,
            3463356488,
            1866414978,
            891333506,
            18488651,
            661792760,
            1628790961,
            3885187036,
            3141171499,
            876946877,
            2693282273,
            1372485963,
            791857591,
            2686433993,
            3759982718,
            3167212022,
            3472953795,
            2716379847,
            445679433,
            3561995674,
            3504004811,
            3574258232,
            54117162,
            3331405415,
            2381918588,
            3769707343,
            4154350007,
            1140177722,
            4074052095,
            668550556,
            3214352940,
            367459370,
            261225585,
            2610173221,
            4209349473,
            3468074219,
            3265815641,
            314222801,
            3066103646,
            3808782860,
            282218597,
            3406013506,
            3773591054,
            379116347,
            1285071038,
            846784868,
            2669647154,
            3771962079,
            3550491691,
            2305946142,
            453669953,
            1268987020,
            3317592352,
            3279303384,
            3744833421,
            2610507566,
            3859509063,
            266596637,
            3847019092,
            517658769,
            3462560207,
            3443424879,
            370717030,
            4247526661,
            2224018117,
            4143653529,
            4112773975,
            2788324899,
            2477274417,
            1456262402,
            2901442914,
            1517677493,
            1846949527,
            2295493580,
            3734397586,
            2176403920,
            1280348187,
            1908823572,
            3871786941,
            846861322,
            1172426758,
            3287448474,
            3383383037,
            1655181056,
            3139813346,
            901632758,
            1897031941,
            2986607138,
            3066810236,
            3447102507,
            1393639104,
            373351379,
            950779232,
            625454576,
            3124240540,
            4148612726,
            2007998917,
            544563296,
            2244738638,
            2330496472,
            2058025392,
            1291430526,
            424198748,
            50039436,
            29584100,
            3605783033,
            2429876329,
            2791104160,
            1057563949,
            3255363231,
            3075367218,
            3463963227,
            1469046755,
            985887462
          ]
        ];
        var t = {
          pbox: [],
          sbox: []
        };
        function E(c, y) {
          let n = y >> 24 & 255, l = y >> 16 & 255, f = y >> 8 & 255, C = y & 255, _ = c.sbox[0][n] + c.sbox[1][l];
          return _ = _ ^ c.sbox[2][f], _ = _ + c.sbox[3][C], _;
        }
        function o(c, y, n) {
          let l = y, f = n, C;
          for (let _ = 0; _ < u; ++_)
            l = l ^ c.pbox[_], f = E(c, l) ^ f, C = l, l = f, f = C;
          return C = l, l = f, f = C, f = f ^ c.pbox[u], l = l ^ c.pbox[u + 1], { left: l, right: f };
        }
        function h(c, y, n) {
          let l = y, f = n, C;
          for (let _ = u + 1; _ > 1; --_)
            l = l ^ c.pbox[_], f = E(c, l) ^ f, C = l, l = f, f = C;
          return C = l, l = f, f = C, f = f ^ c.pbox[1], l = l ^ c.pbox[0], { left: l, right: f };
        }
        function s(c, y, n) {
          for (let A = 0; A < 4; A++) {
            c.sbox[A] = [];
            for (let D = 0; D < 256; D++)
              c.sbox[A][D] = r[A][D];
          }
          let l = 0;
          for (let A = 0; A < u + 2; A++)
            c.pbox[A] = v[A] ^ y[l], l++, l >= n && (l = 0);
          let f = 0, C = 0, _ = 0;
          for (let A = 0; A < u + 2; A += 2)
            _ = o(c, f, C), f = _.left, C = _.right, c.pbox[A] = f, c.pbox[A + 1] = C;
          for (let A = 0; A < 4; A++)
            for (let D = 0; D < 256; D += 2)
              _ = o(c, f, C), f = _.left, C = _.right, c.sbox[A][D] = f, c.sbox[A][D + 1] = C;
          return !0;
        }
        var d = b.Blowfish = a.extend({
          _doReset: function() {
            if (this._keyPriorReset !== this._key) {
              var c = this._keyPriorReset = this._key, y = c.words, n = c.sigBytes / 4;
              s(t, y, n);
            }
          },
          encryptBlock: function(c, y) {
            var n = o(t, c[y], c[y + 1]);
            c[y] = n.left, c[y + 1] = n.right;
          },
          decryptBlock: function(c, y) {
            var n = h(t, c[y], c[y + 1]);
            c[y] = n.left, c[y + 1] = n.right;
          },
          blockSize: 64 / 32,
          keySize: 128 / 32,
          ivSize: 64 / 32
        });
        e.Blowfish = a._createHelper(d);
      }(), i.Blowfish;
    });
  }(Qe)), Qe.exports;
}
(function(m, F) {
  (function(i, e, x) {
    m.exports = e(U(), se(), Ft(), kt(), P0(), Dt(), H0(), Ur(), ar(), wt(), Kr(), Rt(), St(), jt(), nr(), Nt(), D0(), n0(), Pt(), Ht(), Wt(), Tt(), zt(), Lt(), Ot(), It(), qt(), Mt(), $t(), Ut(), Kt(), Xt(), Yt(), Gt(), Vt());
  })(M, function(i) {
    return i;
  });
})($r);
var Zt = $r.exports;
const er = /* @__PURE__ */ ft(Zt), Xr = "openagents-studio-secret-key-2024-v1";
function Qt(m) {
  if (!m)
    throw new Error("Cannot encrypt empty string");
  try {
    const F = er.AES.encrypt(m, Xr).toString();
    return console.log("🔒 Data encrypted for storage"), F;
  } catch (F) {
    throw console.error("❌ Encryption failed:", F), new Error("Failed to encrypt data");
  }
}
function Jt(m) {
  if (!m)
    throw new Error("Cannot decrypt empty string");
  try {
    const i = er.AES.decrypt(m, Xr).toString(er.enc.Utf8);
    if (!i)
      throw new Error("Decryption resulted in empty string - wrong key or corrupted data");
    return console.log("🔓 Data decrypted from storage"), i;
  } catch (F) {
    throw console.error("❌ Decryption failed:", F), new Error("Failed to decrypt data - data may be corrupted");
  }
}
oe()(
  tr(
    (m, F) => ({
      selectedNetwork: null,
      agentName: null,
      passwordHashEncrypted: null,
      // Initialize module state
      moduleState: {
        enabledModules: [],
        defaultRoute: null,
        modulesLoaded: !1,
        networkId: null,
        networkName: null
      },
      handleNetworkSelected: (i) => {
        m({ selectedNetwork: i }), i && F().clearModules();
      },
      setAgentName: (i) => {
        m({ agentName: i });
      },
      clearAgentName: () => {
        m({ agentName: null });
      },
      setPasswordHash: (i) => {
        if (!i) {
          m({ passwordHashEncrypted: null }), console.log("🔑 Password hash cleared");
          return;
        }
        try {
          const e = Qt(i);
          m({ passwordHashEncrypted: e }), console.log("🔑 Password hash encrypted and stored");
        } catch (e) {
          console.error("❌ Failed to encrypt password hash:", e), m({ passwordHashEncrypted: null });
        }
      },
      getPasswordHash: () => {
        const i = F().passwordHashEncrypted;
        if (!i)
          return null;
        try {
          return Jt(i);
        } catch (e) {
          return console.error("❌ Failed to decrypt password hash:", e), F().clearPasswordHash(), null;
        }
      },
      clearPasswordHash: () => {
        m({ passwordHashEncrypted: null }), console.log("🔑 Password hash cleared from storage");
      },
      clearNetwork: () => {
        m({ selectedNetwork: null }), F().clearModules(), F().clearPasswordHash();
      },
      // Module management actions
      setModules: (i) => {
        m({
          moduleState: {
            enabledModules: i.enabledModules,
            defaultRoute: i.defaultRoute,
            modulesLoaded: !0,
            networkId: i.networkId,
            networkName: i.networkName
          }
        });
      },
      clearModules: () => {
        m({
          moduleState: {
            enabledModules: [],
            defaultRoute: null,
            modulesLoaded: !1,
            networkId: null,
            networkName: null
          }
        });
      },
      isModuleLoaded: () => F().moduleState.modulesLoaded,
      getDefaultRoute: () => F().moduleState.defaultRoute || "/profile",
      isModuleEnabled: (i) => F().moduleState.enabledModules.includes(i)
    }),
    {
      name: "auth-storage",
      // key for persistent storage
      partialize: (m) => ({
        selectedNetwork: m.selectedNetwork,
        agentName: m.agentName,
        passwordHashEncrypted: m.passwordHashEncrypted,
        // Persist encrypted password hash
        moduleState: m.moduleState
      })
      // persist network, agent, encrypted password hash, and module state
    }
  )
);
class ea {
  constructor() {
    this.connection = null, this.processedEventIds = /* @__PURE__ */ new Set(), this.forumHandlers = /* @__PURE__ */ new Set(), this.chatHandlers = /* @__PURE__ */ new Set(), this.wikiHandlers = /* @__PURE__ */ new Set(), this.documentHandlers = /* @__PURE__ */ new Set(), this.rawEventHandler = null;
  }
  initialize(F) {
    this.connection !== F && (this.cleanup(), this.connection = F, F && (console.log("EventRouter: Initializing with connection"), this.rawEventHandler = (i) => {
      this.handleRawEvent(i);
    }, F.on("rawEvent", this.rawEventHandler)));
  }
  cleanup() {
    this.connection && this.rawEventHandler && (console.log("EventRouter: Cleaning up event listeners"), this.connection.off("rawEvent", this.rawEventHandler)), this.connection = null, this.rawEventHandler = null, this.processedEventIds.clear();
  }
  handleRawEvent(F) {
    if (console.log(`📨 EventRouter: Received event: ${F.event_name}`, F), F.event_id && this.processedEventIds.has(F.event_id)) {
      console.log(`EventRouter: Skipping duplicate event: ${F.event_id}`);
      return;
    }
    F.event_id && this.processedEventIds.add(F.event_id);
    const i = F.event_name || "";
    if (i.startsWith("forum.") ? (console.log(`EventRouter: Routing forum event: ${i}`), this.forumHandlers.forEach((e) => {
      try {
        e(F);
      } catch (x) {
        console.error("EventRouter: Error in forum event handler:", x);
      }
    })) : i.startsWith("chat.") || i.startsWith("messaging.") || i.startsWith("thread.") || i.startsWith("project.") ? (console.log(`EventRouter: Routing chat/project event: ${i}`), this.chatHandlers.forEach((e) => {
      try {
        e(F);
      } catch (x) {
        console.error("EventRouter: Error in chat event handler:", x);
      }
    })) : i.startsWith("wiki.") ? (console.log(`EventRouter: Routing wiki event: ${i}`), this.wikiHandlers.forEach((e) => {
      try {
        e(F);
      } catch (x) {
        console.error("EventRouter: Error in wiki event handler:", x);
      }
    })) : i.startsWith("document.") ? (console.log(`EventRouter: Routing document event: ${i}`), this.documentHandlers.forEach((e) => {
      try {
        e(F);
      } catch (x) {
        console.error("EventRouter: Error in document event handler:", x);
      }
    })) : console.log(`EventRouter: Unhandled event type: ${i}`), this.processedEventIds.size > 1e3) {
      const e = Array.from(this.processedEventIds);
      e.slice(0, e.length - 1e3).forEach((a) => this.processedEventIds.delete(a));
    }
  }
  onForumEvent(F) {
    this.forumHandlers.add(F), console.log(`EventRouter: Added forum event handler. Total: ${this.forumHandlers.size}`);
  }
  onChatEvent(F) {
    this.chatHandlers.add(F), console.log(`EventRouter: Added chat event handler. Total: ${this.chatHandlers.size}`);
  }
  onWikiEvent(F) {
    this.wikiHandlers.add(F), console.log(`EventRouter: Added wiki event handler. Total: ${this.wikiHandlers.size}`);
  }
  onDocumentEvent(F) {
    this.documentHandlers.add(F), console.log(`EventRouter: Added document event handler. Total: ${this.documentHandlers.size}`);
  }
  offForumEvent(F) {
    this.forumHandlers.delete(F), console.log(`EventRouter: Removed forum event handler. Total: ${this.forumHandlers.size}`);
  }
  offChatEvent(F) {
    this.chatHandlers.delete(F), console.log(`EventRouter: Removed chat event handler. Total: ${this.chatHandlers.size}`);
  }
  offWikiEvent(F) {
    this.wikiHandlers.delete(F), console.log(`EventRouter: Removed wiki event handler. Total: ${this.wikiHandlers.size}`);
  }
  offDocumentEvent(F) {
    this.documentHandlers.delete(F), console.log(`EventRouter: Removed document event handler. Total: ${this.documentHandlers.size}`);
  }
}
const ra = new ea();
typeof window < "u" && (window.__EVENT_ROUTER__ = ra);
const ta = rt(void 0), or = () => {
  const m = tt(ta);
  if (m === void 0)
    throw new Error("useOpenAgents must be used within an OpenAgentsProvider");
  return m;
}, ir = ({
  content: m,
  className: F = "",
  truncate: i = !1,
  maxLength: e = 200
}) => {
  const x = i && m.length > e ? m.substring(0, e) + "..." : m;
  return /* @__PURE__ */ g.jsx("div", { className: `markdown-content ${i ? "truncated" : ""} ${F}`, children: /* @__PURE__ */ g.jsx(
    st,
    {
      remarkPlugins: [xt],
      rehypePlugins: [ct, lt],
      components: {
        // Customize heading styles
        h1: ({ children: a }) => /* @__PURE__ */ g.jsx("h1", { className: "text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200", children: a }),
        h2: ({ children: a }) => /* @__PURE__ */ g.jsx("h2", { className: "text-xl font-semibold mb-3 text-gray-800 dark:text-gray-200", children: a }),
        h3: ({ children: a }) => /* @__PURE__ */ g.jsx("h3", { className: "text-lg font-semibold mb-2 text-gray-700 dark:text-gray-300", children: a }),
        h4: ({ children: a }) => /* @__PURE__ */ g.jsx("h4", { className: "text-base font-semibold mb-2 text-gray-700 dark:text-gray-300", children: a }),
        h5: ({ children: a }) => /* @__PURE__ */ g.jsx("h5", { className: "text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300", children: a }),
        h6: ({ children: a }) => /* @__PURE__ */ g.jsx("h6", { className: "text-sm font-semibold mb-2 text-gray-600 dark:text-gray-400", children: a }),
        // Customize paragraph styles
        p: ({ children: a }) => /* @__PURE__ */ g.jsx("p", { className: "mb-3 leading-relaxed text-gray-700 dark:text-gray-300", children: a }),
        // Customize link styles
        a: ({ href: a, children: b }) => /* @__PURE__ */ g.jsx(
          "a",
          {
            href: a,
            target: "_blank",
            rel: "noopener noreferrer",
            className: "underline hover:no-underline transition-colors text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
            children: b
          }
        ),
        // Customize list styles
        ul: ({ children: a }) => /* @__PURE__ */ g.jsx("ul", { className: "list-disc list-inside mb-3 space-y-1 text-gray-700 dark:text-gray-300", children: a }),
        ol: ({ children: a }) => /* @__PURE__ */ g.jsx("ol", { className: "list-decimal list-inside mb-3 space-y-1 text-gray-700 dark:text-gray-300", children: a }),
        li: ({ children: a }) => /* @__PURE__ */ g.jsx("li", { className: "mb-1", children: a }),
        // Customize blockquote styles
        blockquote: ({ children: a }) => /* @__PURE__ */ g.jsx("blockquote", { className: "border-l-4 pl-4 py-2 mb-3 italic border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300", children: a }),
        // Customize code styles
        code: ({ children: a, className: b }) => !b || !b.includes("language-") ? /* @__PURE__ */ g.jsx("code", { className: "px-1 py-0.5 rounded text-sm font-mono bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300", children: a }) : /* @__PURE__ */ g.jsx("code", { className: `block p-3 rounded-lg text-sm font-mono overflow-x-auto bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 ${b || ""}`, children: a }),
        // Customize pre styles (code blocks)
        pre: ({ children: a }) => /* @__PURE__ */ g.jsx("pre", { className: "mb-3 rounded-lg overflow-x-auto bg-gray-100 dark:bg-gray-800", children: a }),
        // Customize table styles
        table: ({ children: a }) => /* @__PURE__ */ g.jsx("div", { className: "overflow-x-auto mb-3", children: /* @__PURE__ */ g.jsx("table", { className: "min-w-full border-collapse border-gray-300 dark:border-gray-600", children: a }) }),
        th: ({ children: a }) => /* @__PURE__ */ g.jsx("th", { className: "border px-3 py-2 text-left font-semibold border-gray-300 bg-gray-50 text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200", children: a }),
        td: ({ children: a }) => /* @__PURE__ */ g.jsx("td", { className: "border px-3 py-2 border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300", children: a }),
        // Customize horizontal rule
        hr: () => /* @__PURE__ */ g.jsx("hr", { className: "my-4 border-gray-300 dark:border-gray-600" }),
        // Customize strong/bold text
        strong: ({ children: a }) => /* @__PURE__ */ g.jsx("strong", { className: "font-semibold text-gray-800 dark:text-gray-200", children: a }),
        // Customize emphasis/italic text
        em: ({ children: a }) => /* @__PURE__ */ g.jsx("em", { className: "italic text-gray-700 dark:text-gray-300", children: a })
      },
      children: x
    }
  ) });
}, Yr = ({
  oldValue: m = "",
  newValue: F = "",
  oldTitle: i = "Original",
  newTitle: e = "Modified",
  className: x = "",
  showLineNumbers: a = !0
}) => {
  const b = at(() => dt(m, F), [m, F]), u = () => {
    let v = 1, r = 1;
    return b.map((t, E) => {
      const o = t.value.split(`
`);
      return o[o.length - 1] === "" && o.pop(), o.map((h, s) => {
        const d = `${E}-${s}`;
        let c = "normal", y = v, n = r;
        return t.added ? (c = "insert", y = 0) : t.removed && (c = "delete", n = 0), t.added || v++, t.removed || r++, /* @__PURE__ */ g.jsxs(
          "div",
          {
            className: `flex text-sm font-mono leading-relaxed border-l-4 ${c === "insert" ? "bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-600" : c === "delete" ? "bg-red-50 dark:bg-red-900/20 border-red-400 dark:border-red-600" : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600"}`,
            children: [
              a && /* @__PURE__ */ g.jsxs("div", { className: "flex text-xs text-gray-500 dark:text-gray-400 select-none", children: [
                /* @__PURE__ */ g.jsx("span", { className: "w-10 text-right pr-2 py-1", children: y > 0 ? y : "" }),
                /* @__PURE__ */ g.jsx("span", { className: "w-10 text-right pr-2 py-1", children: n > 0 ? n : "" })
              ] }),
              /* @__PURE__ */ g.jsx("div", { className: "flex-1 px-2 py-1", children: /* @__PURE__ */ g.jsxs(
                "span",
                {
                  className: `${c === "insert" ? "text-green-800 dark:text-green-200" : c === "delete" ? "text-red-800 dark:text-red-200" : "text-gray-800 dark:text-gray-200"}`,
                  children: [
                    c === "insert" && "+ ",
                    c === "delete" && "- ",
                    c === "normal" && "  ",
                    h || " "
                  ]
                }
              ) })
            ]
          },
          d
        );
      });
    }).flat();
  };
  return !m && !F ? /* @__PURE__ */ g.jsx("div", { className: "text-center py-8 text-gray-500 dark:text-gray-400", children: "No content to compare" }) : m === F ? /* @__PURE__ */ g.jsx("div", { className: "text-center py-8 text-green-600 dark:text-green-400", children: "No changes detected" }) : /* @__PURE__ */ g.jsxs("div", { className: `diff-viewer ${x}`, children: [
    /* @__PURE__ */ g.jsx("div", { className: "flex justify-between items-center mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg", children: /* @__PURE__ */ g.jsxs("div", { className: "text-sm font-medium text-gray-700 dark:text-gray-300", children: [
      "Comparing: ",
      /* @__PURE__ */ g.jsx("span", { className: "text-red-600 dark:text-red-400", children: i }),
      " vs ",
      /* @__PURE__ */ g.jsx("span", { className: "text-green-600 dark:text-green-400", children: e })
    ] }) }),
    /* @__PURE__ */ g.jsx("div", { className: "border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden", children: /* @__PURE__ */ g.jsx("div", { className: "max-h-96 overflow-y-auto", children: u() }) })
  ] });
}, aa = oe()(
  tr(
    (m, F) => ({
      theme: "light",
      toggleTheme: () => {
        const e = F().theme === "light" ? "dark" : "light";
        m({ theme: e }), typeof document < "u" && (e === "dark" ? document.documentElement.classList.add("dark") : document.documentElement.classList.remove("dark"));
      },
      setTheme: (i) => {
        m({ theme: i }), typeof document < "u" && (i === "dark" ? document.documentElement.classList.add("dark") : document.documentElement.classList.remove("dark"));
      }
    }),
    {
      name: "wiki-theme-storage"
    }
  )
);
const Gr = ({
  value: m,
  onChange: F,
  modes: i,
  oldValue: e = "",
  oldTitle: x = "Original",
  newTitle: a = "Modified",
  className: b = "",
  style: u = { height: "400px" },
  placeholder: v = "Enter content in Markdown format...",
  textareaProps: r
}) => {
  const [t, E] = E0(i[0] || "edit"), { theme: o } = aa();
  g0(() => {
    i.includes(t) || E(i[0] || "edit");
  }, [i, t]);
  const h = (d) => {
    switch (d) {
      case "edit":
        return "Edit";
      case "preview":
        return "Preview";
      case "diff":
        return "Diff";
      default:
        return d;
    }
  }, s = () => {
    switch (t) {
      case "edit":
        return /* @__PURE__ */ g.jsx("div", { "data-color-mode": o, className: "flex-1", children: /* @__PURE__ */ g.jsx(
          it,
          {
            value: m,
            onChange: (d) => F(d || ""),
            preview: "edit",
            hideToolbar: !1,
            visibleDragbar: !1,
            style: u,
            textareaProps: {
              placeholder: v,
              style: {
                fontSize: 14,
                lineHeight: 1.6,
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace'
              },
              ...r
            }
          }
        ) });
      case "preview":
        return /* @__PURE__ */ g.jsx("div", { className: "flex-1 max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-white dark:bg-gray-800", children: /* @__PURE__ */ g.jsx("div", { className: "max-w-none", children: /* @__PURE__ */ g.jsx(
          ir,
          {
            content: m || "Nothing to preview",
            className: "prose max-w-none dark:prose-invert text-gray-700 dark:text-gray-300"
          }
        ) }) });
      case "diff":
        return /* @__PURE__ */ g.jsx("div", { className: "flex-1 overflow-auto", children: /* @__PURE__ */ g.jsx(
          Yr,
          {
            oldValue: e,
            newValue: m,
            oldTitle: x,
            newTitle: a
          }
        ) });
      default:
        return null;
    }
  };
  return /* @__PURE__ */ g.jsxs("div", { className: `wiki-editor ${b}`, children: [
    i.length > 1 && /* @__PURE__ */ g.jsx("div", { className: "flex justify-between items-center mb-4", children: /* @__PURE__ */ g.jsx("div", { className: "flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600", children: i.map((d) => /* @__PURE__ */ g.jsx(
      "button",
      {
        type: "button",
        onClick: () => E(d),
        className: `px-3 py-1 text-sm ${t === d ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"}`,
        children: h(d)
      },
      d
    )) }) }),
    /* @__PURE__ */ g.jsx("div", { className: "flex-1 flex flex-col", style: u, children: s() })
  ] });
}, na = ({ isOpen: m, onClose: F }) => {
  const [i, e] = E0(""), [x, a] = E0(""), [b, u] = E0(""), { createPage: v } = ie();
  g0(() => {
    m && (e(""), a(""), u(""));
  }, [m]);
  const r = async (E) => {
    if (E.preventDefault(), !i.trim() || !x.trim() || !b.trim())
      return;
    await v(i, x, b) && F();
  }, t = () => {
    F();
  };
  return m ? /* @__PURE__ */ g.jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", children: /* @__PURE__ */ g.jsxs("div", { className: "w-full max-w-4xl h-5/6 mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800", children: [
    /* @__PURE__ */ g.jsx("div", { className: "px-6 py-4 border-b border-gray-200 dark:border-gray-700", children: /* @__PURE__ */ g.jsxs("div", { className: "flex items-center justify-between", children: [
      /* @__PURE__ */ g.jsx("h3", { className: "text-lg font-medium text-gray-900 dark:text-gray-100", children: "Create New Wiki Page" }),
      /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: t,
          className: "p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400",
          children: /* @__PURE__ */ g.jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ g.jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) })
        }
      )
    ] }) }),
    /* @__PURE__ */ g.jsx("div", { className: "flex-1 px-6 py-4 overflow-hidden", children: /* @__PURE__ */ g.jsxs("form", { id: "wiki-form", onSubmit: r, className: "flex-1 flex flex-col space-y-4", children: [
      /* @__PURE__ */ g.jsxs("div", { children: [
        /* @__PURE__ */ g.jsx("label", { className: "block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300", children: "Page Path" }),
        /* @__PURE__ */ g.jsx(
          "input",
          {
            type: "text",
            value: i,
            onChange: (E) => e(E.target.value),
            placeholder: "Page path (e.g., /getting-started)",
            className: "w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400",
            required: !0
          }
        )
      ] }),
      /* @__PURE__ */ g.jsxs("div", { children: [
        /* @__PURE__ */ g.jsx("label", { className: "block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300", children: "Page Title" }),
        /* @__PURE__ */ g.jsx(
          "input",
          {
            type: "text",
            value: x,
            onChange: (E) => a(E.target.value),
            placeholder: "Page title...",
            className: "w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400",
            required: !0
          }
        )
      ] }),
      /* @__PURE__ */ g.jsxs("div", { className: "flex-1 flex flex-col", children: [
        /* @__PURE__ */ g.jsx("label", { className: "block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300", children: "Content" }),
        /* @__PURE__ */ g.jsx(
          Gr,
          {
            value: b,
            onChange: u,
            modes: ["edit", "preview"],
            style: { minHeight: "200px", maxHeight: "200px" },
            placeholder: "Enter page content in Markdown format...",
            textareaProps: { required: !0 }
          }
        )
      ] })
    ] }) }),
    /* @__PURE__ */ g.jsxs("div", { className: "px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3", children: [
      /* @__PURE__ */ g.jsx(
        "button",
        {
          type: "button",
          onClick: t,
          className: "px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          children: "Cancel"
        }
      ),
      /* @__PURE__ */ g.jsx(
        "button",
        {
          type: "submit",
          form: "wiki-form",
          disabled: !i.trim() || !x.trim() || !b.trim(),
          className: "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
          children: "Create Page"
        }
      )
    ] })
  ] }) }) : null;
}, Vr = (m, F) => {
  const { includeTime: i = !0, locale: e = "zh-CN" } = F || {};
  if (!m || m <= 0)
    return "Unknown date";
  let x = m;
  m < 1e10 && (x = m * 1e3);
  const a = new Date(x);
  return isNaN(a.getTime()) ? "Invalid date" : i ? a.toLocaleString(e) : a.toLocaleDateString(e);
}, oa = () => {
  const [m, F] = E0(!1), [i, e] = E0(""), x = rr(), { connector: a, isConnected: b } = or(), u = Z0.useMemo(() => a ? {
    sendEvent: async (f) => await a.sendEvent({
      event_name: f.event_name,
      destination_id: f.destination_id,
      payload: f.payload
    }),
    getAgentId: () => a.getAgentId() || null
  } : null, [a]), { addRecentPage: v } = Ct(), {
    pages: r,
    proposals: t,
    pagesLoading: E,
    pagesError: o,
    setService: h,
    loadPages: s,
    loadProposals: d,
    searchPages: c,
    setupEventListeners: y,
    cleanupEventListeners: n
  } = ie();
  g0(() => {
    console.log("WikiPageList: Service from context:", {
      hasService: !!u,
      isConnected: b,
      serviceType: u ? typeof u : "null"
    }), u ? (console.log("WikiPageList: Setting service to store"), h(u)) : console.warn("WikiPageList: Service is null, cannot set to store");
  }, [u, b, h]), g0(() => {
    u && b && (console.log("WikiPageList: Connection ready, loading pages"), s(), d());
  }, [u, b, s, d]), g0(() => {
    if (u)
      return console.log("WikiPageList: Setting up wiki event listeners"), y(), () => {
        console.log("WikiPageList: Cleaning up wiki event listeners"), n();
      };
  }, [u, y, n]), g0(() => {
    const f = setTimeout(() => {
      c(i);
    }, 300);
    return () => clearTimeout(f);
  }, [i, c]);
  const l = (f) => {
    const C = r.find((_) => _.page_path === f);
    C && (console.log("WikiPageList: Adding page to recent pages:", C.title), v(C)), console.log(
      "WikiPageList: Navigating to page:",
      f,
      "URL:",
      `/wiki/detail/${encodeURIComponent(f)}`
    ), x(`/wiki/detail/${encodeURIComponent(f)}`);
  };
  return E && r.length === 0 ? /* @__PURE__ */ g.jsx("div", { className: "flex-1 flex items-center justify-center dark:bg-gray-900", children: /* @__PURE__ */ g.jsxs("div", { className: "text-center", children: [
    /* @__PURE__ */ g.jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" }),
    /* @__PURE__ */ g.jsx("p", { className: "text-gray-600 dark:text-gray-400", children: "Loading wiki pages..." })
  ] }) }) : o ? /* @__PURE__ */ g.jsx("div", { className: "flex-1 flex items-center justify-center", children: /* @__PURE__ */ g.jsxs("div", { className: "text-center", children: [
    /* @__PURE__ */ g.jsx("div", { className: "text-red-500 mb-4", children: /* @__PURE__ */ g.jsx(
      "svg",
      {
        className: "w-12 h-12 mx-auto",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
        children: /* @__PURE__ */ g.jsx(
          "path",
          {
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: 2,
            d: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          }
        )
      }
    ) }),
    /* @__PURE__ */ g.jsx("p", { className: "mb-4 text-gray-700 dark:text-gray-300", children: o }),
    /* @__PURE__ */ g.jsx(
      "button",
      {
        onClick: s,
        className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors",
        children: "Try Again"
      }
    )
  ] }) }) : /* @__PURE__ */ g.jsxs("div", { className: "flex-1 flex flex-col h-full", children: [
    /* @__PURE__ */ g.jsxs("div", { className: "px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:border-gray-700 dark:bg-gray-800", children: [
      /* @__PURE__ */ g.jsxs("div", { children: [
        /* @__PURE__ */ g.jsx("h1", { className: "text-2xl font-bold text-gray-900 dark:text-gray-100", children: "Wiki" }),
        /* @__PURE__ */ g.jsxs("p", { className: "text-sm mt-1 text-gray-600 dark:text-gray-400", children: [
          r.length,
          " pages available"
        ] })
      ] }),
      /* @__PURE__ */ g.jsxs("div", { className: "flex items-center space-x-3", children: [
        t.filter((f) => f.status === "pending").length > 0 && /* @__PURE__ */ g.jsxs(
          "button",
          {
            onClick: () => x("/wiki/proposals"),
            className: "flex items-center space-x-2 px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors",
            children: [
              /* @__PURE__ */ g.jsx(
                "svg",
                {
                  className: "w-4 h-4",
                  fill: "none",
                  stroke: "currentColor",
                  viewBox: "0 0 24 24",
                  children: /* @__PURE__ */ g.jsx(
                    "path",
                    {
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: 2,
                      d: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    }
                  )
                }
              ),
              /* @__PURE__ */ g.jsxs("span", { children: [
                "Proposals (",
                t.filter((f) => f.status === "pending").length,
                ")"
              ] })
            ]
          }
        ),
        /* @__PURE__ */ g.jsxs(
          "button",
          {
            onClick: () => F(!0),
            className: "flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors",
            children: [
              /* @__PURE__ */ g.jsx(
                "svg",
                {
                  className: "w-4 h-4",
                  fill: "none",
                  stroke: "currentColor",
                  viewBox: "0 0 24 24",
                  children: /* @__PURE__ */ g.jsx(
                    "path",
                    {
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                      strokeWidth: 2,
                      d: "M12 4v16m8-8H4"
                    }
                  )
                }
              ),
              /* @__PURE__ */ g.jsx("span", { children: "New Page" })
            ]
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ g.jsx("div", { className: "px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800", children: /* @__PURE__ */ g.jsxs("div", { className: "relative", children: [
      /* @__PURE__ */ g.jsx(
        "input",
        {
          type: "text",
          value: i,
          onChange: (f) => e(f.target.value),
          placeholder: "Search wiki pages...",
          className: "w-full pl-10 pr-4 py-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
        }
      ),
      /* @__PURE__ */ g.jsx(
        "svg",
        {
          className: "absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ g.jsx(
            "path",
            {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            }
          )
        }
      )
    ] }) }),
    /* @__PURE__ */ g.jsx("div", { className: "flex-1 overflow-y-hidden py-6 dark:border-gray-700 bg-gray-50 dark:bg-gray-900", children: r.length === 0 ? /* @__PURE__ */ g.jsxs("div", { className: "text-center py-12 h-full flex flex-col items-center justify-center", children: [
      /* @__PURE__ */ g.jsx("div", { className: "mb-4 text-gray-500 dark:text-gray-400", children: /* @__PURE__ */ g.jsx(
        "svg",
        {
          className: "w-16 h-16 mx-auto",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ g.jsx(
            "path",
            {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 1,
              d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            }
          )
        }
      ) }),
      /* @__PURE__ */ g.jsx("h3", { className: "text-lg font-medium mb-2 text-gray-700 dark:text-gray-300", children: i ? "No pages found" : "No pages yet" }),
      /* @__PURE__ */ g.jsx("p", { className: "mb-4 text-gray-600 dark:text-gray-400", children: i ? "No pages found matching your search" : "Create your first wiki page to get started!" }),
      !i && /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: () => F(!0),
          className: "px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors",
          children: "Create First Page"
        }
      )
    ] }) : /* @__PURE__ */ g.jsx("div", { className: "h-full px-6 overflow-y-auto space-y-4", children: r.map((f) => /* @__PURE__ */ g.jsx(
      "div",
      {
        onClick: () => l(f.page_path),
        className: "p-4 rounded-lg border cursor-pointer transition-all hover:shadow-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-300 dark:hover:border-gray-600",
        children: /* @__PURE__ */ g.jsx("div", { className: "flex items-start justify-between", children: /* @__PURE__ */ g.jsxs("div", { className: "flex-1", children: [
          /* @__PURE__ */ g.jsx("h3", { className: "text-lg font-semibold mb-2 line-clamp-2 text-gray-900 dark:text-gray-100", children: f.title || "Untitled" }),
          /* @__PURE__ */ g.jsx("div", { className: "text-sm mb-3 line-clamp-3 text-gray-600 dark:text-gray-400 wiki-list-preview", children: /* @__PURE__ */ g.jsx(
            ir,
            {
              content: f.wiki_content || "No content",
              className: "prose-sm max-w-none"
            }
          ) }),
          /* @__PURE__ */ g.jsxs("div", { className: "flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400", children: [
            /* @__PURE__ */ g.jsx("span", { children: f.page_path || "Unknown path" }),
            /* @__PURE__ */ g.jsxs("span", { children: [
              "by ",
              f.creator_id || "Unknown"
            ] }),
            /* @__PURE__ */ g.jsxs("span", { children: [
              "v",
              f.version || 1
            ] }),
            /* @__PURE__ */ g.jsx("span", { children: Vr(f.last_modified) })
          ] })
        ] }) })
      },
      f.page_path
    )) }) }),
    /* @__PURE__ */ g.jsx(
      na,
      {
        isOpen: m,
        onClose: () => F(!1)
      }
    )
  ] });
}, ia = () => {
  const [m, F] = E0(!1), [i, e] = E0(""), [x, a] = E0(""), b = rr(), { pagePath: u } = nt(), { connector: v } = or(), r = Z0.useMemo(() => v ? {
    sendEvent: async (A) => await v.sendEvent({
      event_name: A.event_name,
      destination_id: A.destination_id,
      payload: A.payload
    }),
    getAgentId: () => v.getAgentId() || null
  } : null, [v]), {
    selectedPage: t,
    pagesError: E,
    setService: o,
    loadPage: h,
    editPage: s,
    proposeEdit: d,
    setSelectedPage: c,
    clearError: y
  } = ie();
  g0(() => {
    r && o(r);
  }, [r, o]), g0(() => {
    if (u && r) {
      const A = decodeURIComponent(u);
      console.log("WikiPageDetail: Loading page:", A), h(A);
    }
    return () => {
      c(null);
    };
  }, [u, r, h, c]), g0(() => {
    t && m && e(t.wiki_content);
  }, [t, m]);
  const n = () => {
    b("/wiki");
  }, l = () => {
    F(!0), y();
  }, f = async () => {
    if (!t)
      return;
    const A = t.creator_id === (r == null ? void 0 : r.getAgentId());
    let D = !1;
    A ? D = await s(t.page_path, i) : D = await d(
      t.page_path,
      i,
      x
    ), D && (F(!1), e(""), a(""));
  }, C = () => {
    F(!1), e(""), a(""), y();
  };
  if (!t)
    return /* @__PURE__ */ g.jsx("div", { className: "flex-1 flex items-center justify-center dark:bg-gray-900", children: /* @__PURE__ */ g.jsxs("div", { className: "text-center", children: [
      /* @__PURE__ */ g.jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" }),
      /* @__PURE__ */ g.jsx("p", { className: "text-gray-600 dark:text-gray-400", children: "Loading page..." })
    ] }) });
  if (E)
    return /* @__PURE__ */ g.jsx("div", { className: "flex-1 flex items-center justify-center", children: /* @__PURE__ */ g.jsxs("div", { className: "text-center", children: [
      /* @__PURE__ */ g.jsx("div", { className: "text-red-500 mb-4", children: /* @__PURE__ */ g.jsx(
        "svg",
        {
          className: "w-12 h-12 mx-auto",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ g.jsx(
            "path",
            {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            }
          )
        }
      ) }),
      /* @__PURE__ */ g.jsx("p", { className: "mb-4 text-gray-700 dark:text-gray-300", children: E }),
      /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: n,
          className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors",
          children: "Back to Wiki"
        }
      )
    ] }) });
  const _ = t.creator_id === (r == null ? void 0 : r.getAgentId());
  return /* @__PURE__ */ g.jsxs("div", { className: "flex-1 flex flex-col h-full", children: [
    /* @__PURE__ */ g.jsxs("div", { className: "px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:border-gray-700 dark:bg-gray-800", children: [
      /* @__PURE__ */ g.jsxs("div", { className: "flex items-center space-x-3", children: [
        /* @__PURE__ */ g.jsx(
          "button",
          {
            onClick: () => b("/wiki/"),
            className: "py-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
            children: /* @__PURE__ */ g.jsx(
              "svg",
              {
                className: "w-5 h-5",
                fill: "none",
                stroke: "currentColor",
                viewBox: "0 0 24 24",
                children: /* @__PURE__ */ g.jsx(
                  "path",
                  {
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    strokeWidth: 2,
                    d: "M15 19l-7-7 7-7"
                  }
                )
              }
            )
          }
        ),
        /* @__PURE__ */ g.jsxs("div", { className: "flex-1", children: [
          /* @__PURE__ */ g.jsx("h1", { className: "text-2xl font-bold line-clamp-1 text-gray-900 dark:text-gray-100", children: t.title || "Untitled" }),
          /* @__PURE__ */ g.jsxs("p", { className: "text-sm text-gray-600 dark:text-gray-400 mt-1", children: [
            t.page_path || "Unknown path",
            " • by",
            " ",
            t.creator_id || "Unknown",
            " • v",
            t.version || 1
          ] })
        ] })
      ] }),
      /* @__PURE__ */ g.jsx("div", { className: "flex space-x-2", children: _ ? /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: l,
          className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors",
          children: "Edit"
        }
      ) : /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: l,
          className: "px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap",
          children: "Propose Edit"
        }
      ) })
    ] }),
    /* @__PURE__ */ g.jsx("div", { className: "flex-1 overflow-y-auto px-6 py-6 dark:bg-gray-900", children: /* @__PURE__ */ g.jsx("div", { className: "max-w-none", children: /* @__PURE__ */ g.jsx(
      ir,
      {
        content: t.wiki_content || "No content available",
        className: "prose max-w-none dark:prose-invert text-gray-700 dark:text-gray-300"
      }
    ) }) }),
    m && /* @__PURE__ */ g.jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", children: /* @__PURE__ */ g.jsxs("div", { className: "w-full max-w-4xl h-5/6 mx-4 flex flex-col rounded-lg bg-white dark:bg-gray-800", children: [
      /* @__PURE__ */ g.jsx("div", { className: "p-6 border-b border-gray-200 dark:border-gray-700", children: /* @__PURE__ */ g.jsxs("h2", { className: "text-xl font-bold text-gray-900 dark:text-gray-100", children: [
        _ ? "Edit" : "Propose Edit",
        ": ",
        t.title
      ] }) }),
      /* @__PURE__ */ g.jsxs("div", { className: "flex-1 p-6 space-y-4 overflow-hidden", children: [
        E && /* @__PURE__ */ g.jsx("div", { className: "p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg", children: /* @__PURE__ */ g.jsx("p", { className: "text-red-700 dark:text-red-300 text-sm", children: E }) }),
        /* @__PURE__ */ g.jsx(
          Gr,
          {
            value: i,
            onChange: e,
            modes: ["edit", "preview", "diff"],
            oldValue: (t == null ? void 0 : t.wiki_content) || "",
            oldTitle: "Current Version",
            newTitle: "Your Changes",
            style: { height: "200px" },
            placeholder: "Enter page content in Markdown format..."
          }
        ),
        !_ && /* @__PURE__ */ g.jsxs("div", { children: [
          /* @__PURE__ */ g.jsx("label", { className: "block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300", children: "Rationale for Change" }),
          /* @__PURE__ */ g.jsx(
            "textarea",
            {
              value: x,
              onChange: (A) => a(A.target.value),
              className: "w-full p-3 rounded-lg border resize-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400",
              rows: 3,
              placeholder: "Explain why you want to make this change..."
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ g.jsxs("div", { className: "p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3", children: [
        /* @__PURE__ */ g.jsx(
          "button",
          {
            onClick: C,
            className: "px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
            children: "Cancel"
          }
        ),
        /* @__PURE__ */ g.jsx(
          "button",
          {
            onClick: f,
            disabled: !_ && !x.trim(),
            className: "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
            children: _ ? "Save Changes" : "Submit Proposal"
          }
        )
      ] })
    ] }) })
  ] });
}, sa = () => {
  const m = rr(), { connector: F } = or(), i = Z0.useMemo(() => F ? {
    sendEvent: async (C) => await F.sendEvent({
      event_name: C.event_name,
      destination_id: C.destination_id,
      payload: C.payload
    }),
    getAgentId: () => F.getAgentId() || null
  } : null, [F]), [e, x] = E0(null), [a, b] = E0(
    {}
  ), {
    proposals: u,
    pages: v,
    pagesError: r,
    setService: t,
    loadProposals: E,
    loadPages: o,
    loadPage: h,
    resolveProposal: s,
    clearError: d
  } = ie();
  g0(() => {
    i && t(i);
  }, [i, t]), g0(() => {
    i && (console.log("WikiProposals: Loading proposals"), E(), o());
  }, [i, E, o]);
  const c = async (C) => {
    if (a[C])
      return a[C];
    const _ = v.find((A) => A.page_path === C);
    if (_) {
      const A = _.wiki_content || "";
      return b((D) => ({ ...D, [C]: A })), A;
    }
    try {
      await h(C);
      const D = v.find(
        (B) => B.page_path === C
      ), W = (D == null ? void 0 : D.wiki_content) || "";
      return b((B) => ({ ...B, [C]: W })), W;
    } catch (A) {
      return console.error("Failed to load page content for diff:", A), "";
    }
  }, y = async (C, _) => {
    e === C ? x(null) : (x(C), await c(_));
  }, n = () => {
    m("/wiki/");
  }, l = async (C, _) => {
    await s(C, _);
  }, f = u.filter((C) => C.status === "pending");
  return /* @__PURE__ */ g.jsxs("div", { className: "flex-1 flex flex-col h-full dark:bg-gray-900", children: [
    /* @__PURE__ */ g.jsx("div", { className: "px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:border-gray-700 dark:bg-gray-800", children: /* @__PURE__ */ g.jsxs("div", { className: "flex items-center space-x-3", children: [
      /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: n,
          className: "py-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200",
          children: /* @__PURE__ */ g.jsx(
            "svg",
            {
              className: "w-5 h-5",
              fill: "none",
              stroke: "currentColor",
              viewBox: "0 0 24 24",
              children: /* @__PURE__ */ g.jsx(
                "path",
                {
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  strokeWidth: 2,
                  d: "M15 19l-7-7 7-7"
                }
              )
            }
          )
        }
      ),
      /* @__PURE__ */ g.jsxs("div", { children: [
        /* @__PURE__ */ g.jsx("h1", { className: "text-2xl font-bold text-gray-900 dark:text-gray-100", children: "Edit Proposals" }),
        /* @__PURE__ */ g.jsxs("p", { className: "text-sm mt-1 text-gray-600 dark:text-gray-400", children: [
          f.length,
          " pending proposals"
        ] })
      ] })
    ] }) }),
    r && /* @__PURE__ */ g.jsxs("div", { className: "mx-6 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg", children: [
      /* @__PURE__ */ g.jsx("p", { className: "text-red-700 dark:text-red-300 text-sm", children: r }),
      /* @__PURE__ */ g.jsx(
        "button",
        {
          onClick: d,
          className: "mt-2 text-xs text-red-600 dark:text-red-400 underline",
          children: "Dismiss"
        }
      )
    ] }),
    /* @__PURE__ */ g.jsx("div", { className: "flex-1 overflow-y-auto px-6 py-6 dark:bg-gray-900", children: f.length === 0 ? /* @__PURE__ */ g.jsxs("div", { className: "text-center py-12 h-full flex flex-col items-center justify-center", children: [
      /* @__PURE__ */ g.jsx("div", { className: "mb-4 text-gray-500 dark:text-gray-400", children: /* @__PURE__ */ g.jsx(
        "svg",
        {
          className: "w-16 h-16 mx-auto",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ g.jsx(
            "path",
            {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 1,
              d: "M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            }
          )
        }
      ) }),
      /* @__PURE__ */ g.jsx("h3", { className: "text-lg font-medium mb-2 text-gray-700 dark:text-gray-300", children: "No pending proposals" }),
      /* @__PURE__ */ g.jsx("p", { className: "mb-4 text-gray-600 dark:text-gray-400", children: "All proposals have been reviewed" })
    ] }) : /* @__PURE__ */ g.jsx("div", { className: "space-y-4", children: f.map((C) => {
      const _ = e === C.proposal_id, A = a[C.page_path] || "";
      return /* @__PURE__ */ g.jsxs(
        "div",
        {
          className: "p-4 rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700",
          children: [
            /* @__PURE__ */ g.jsxs("div", { className: "flex items-start justify-between mb-3", children: [
              /* @__PURE__ */ g.jsxs("div", { className: "flex-1", children: [
                /* @__PURE__ */ g.jsxs("div", { className: "flex items-center gap-2", children: [
                  /* @__PURE__ */ g.jsx("h3", { className: "font-semibold text-gray-900 dark:text-gray-100", children: C.page_path }),
                  /* @__PURE__ */ g.jsx(
                    "button",
                    {
                      onClick: () => y(
                        C.proposal_id,
                        C.page_path
                      ),
                      className: "text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors",
                      children: /* @__PURE__ */ g.jsx(
                        "svg",
                        {
                          className: `w-4 h-4 transform transition-transform ${_ ? "rotate-180" : ""}`,
                          fill: "none",
                          stroke: "currentColor",
                          viewBox: "0 0 24 24",
                          children: /* @__PURE__ */ g.jsx(
                            "path",
                            {
                              strokeLinecap: "round",
                              strokeLinejoin: "round",
                              strokeWidth: 2,
                              d: "M19 9l-7 7-7-7"
                            }
                          )
                        }
                      )
                    }
                  )
                ] }),
                /* @__PURE__ */ g.jsxs("p", { className: "text-sm text-gray-600 dark:text-gray-400 mt-1", children: [
                  "by ",
                  C.proposed_by,
                  " •",
                  " ",
                  Vr(C.created_timestamp / 1e3)
                ] })
              ] }),
              /* @__PURE__ */ g.jsxs("div", { className: "flex space-x-2 ml-4", children: [
                /* @__PURE__ */ g.jsx(
                  "button",
                  {
                    onClick: () => l(C.proposal_id, "approve"),
                    className: "px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors",
                    children: "Approve"
                  }
                ),
                /* @__PURE__ */ g.jsx(
                  "button",
                  {
                    onClick: () => l(C.proposal_id, "reject"),
                    className: "px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors",
                    children: "Reject"
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ g.jsxs("div", { className: "mb-3", children: [
              /* @__PURE__ */ g.jsx("div", { className: "text-sm font-medium text-gray-700 dark:text-gray-300 mb-1", children: "Rationale:" }),
              /* @__PURE__ */ g.jsx("div", { className: "text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded", children: C.rationale })
            ] }),
            _ ? /* @__PURE__ */ g.jsxs("div", { className: "mt-4", children: [
              /* @__PURE__ */ g.jsx("div", { className: "text-sm font-medium text-gray-700 dark:text-gray-300 mb-2", children: "Changes:" }),
              /* @__PURE__ */ g.jsx(
                Yr,
                {
                  oldValue: A,
                  newValue: C.proposed_content || "",
                  oldTitle: "Current Version",
                  newTitle: "Proposed Version",
                  viewType: "unified"
                }
              )
            ] }) : /* @__PURE__ */ g.jsxs("div", { children: [
              /* @__PURE__ */ g.jsx("div", { className: "text-sm font-medium text-gray-700 dark:text-gray-300 mb-1", children: "Proposed content preview:" }),
              /* @__PURE__ */ g.jsx("div", { className: "text-xs p-2 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300", children: /* @__PURE__ */ g.jsxs("div", { className: "whitespace-pre-wrap", children: [
                C.proposed_content ? C.proposed_content.substring(0, 300) : "No content",
                C.proposed_content && C.proposed_content.length > 300 && "..."
              ] }) }),
              /* @__PURE__ */ g.jsx("div", { className: "mt-2", children: /* @__PURE__ */ g.jsx(
                "button",
                {
                  onClick: () => y(
                    C.proposal_id,
                    C.page_path
                  ),
                  className: "text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors",
                  children: "View detailed changes →"
                }
              ) })
            ] })
          ]
        },
        C.proposal_id
      );
    }) }) })
  ] });
}, xa = () => /* @__PURE__ */ g.jsxs(ot, { children: [
  /* @__PURE__ */ g.jsx(ge, { index: !0, element: /* @__PURE__ */ g.jsx(oa, {}) }),
  /* @__PURE__ */ g.jsx(ge, { path: "detail/:pagePath", element: /* @__PURE__ */ g.jsx(ia, {}) }),
  /* @__PURE__ */ g.jsx(ge, { path: "proposals", element: /* @__PURE__ */ g.jsx(sa, {}) })
] }), ma = () => /* @__PURE__ */ g.jsx(xa, {});
export {
  ma as default
};
