/**
 * Rigorous Complex Number implementation for optical physics and Transfer Matrix calculations
 */

export class Complex {
  readonly re: number;
  readonly im: number;

  constructor(re: number = 0, im: number = 0) {
    this.re = Number.isFinite(re) ? re : 0;
    this.im = Number.isFinite(im) ? im : 0;
  }

  static from(re: number = 0, im: number = 0): Complex {
    return new Complex(re, im);
  }

  static readonly ZERO = new Complex(0, 0);
  static readonly ONE = new Complex(1, 0);
  static readonly I = new Complex(0, 1);

  add(other: Complex | number): Complex {
    if (typeof other === 'number') {
      return new Complex(this.re + other, this.im);
    }
    return new Complex(this.re + other.re, this.im + other.im);
  }

  sub(other: Complex | number): Complex {
    if (typeof other === 'number') {
      return new Complex(this.re - other, this.im);
    }
    return new Complex(this.re - other.re, this.im - other.im);
  }

  mul(other: Complex | number): Complex {
    if (typeof other === 'number') {
      return new Complex(this.re * other, this.im * other);
    }
    return new Complex(
      this.re * other.re - this.im * other.im,
      this.re * other.im + this.im * other.re
    );
  }

  div(other: Complex | number): Complex {
    if (typeof other === 'number') {
      if (other === 0) return new Complex(Infinity, Infinity);
      return new Complex(this.re / other, this.im / other);
    }
    const denom = other.re * other.re + other.im * other.im;
    if (denom === 0) {
      return new Complex(Infinity, Infinity);
    }
    return new Complex(
      (this.re * other.re + this.im * other.im) / denom,
      (this.im * other.re - this.re * other.im) / denom
    );
  }

  abs(): number {
    return Math.hypot(this.re, this.im);
  }

  absSq(): number {
    return this.re * this.re + this.im * this.im;
  }

  arg(): number {
    return Math.atan2(this.im, this.re);
  }

  conj(): Complex {
    return new Complex(this.re, -this.im);
  }

  neg(): Complex {
    return new Complex(-this.re, -this.im);
  }

  /**
   * Principal square root of complex number: sqrt(z)
   * With branch cut along negative real axis
   */
  sqrt(): Complex {
    const r = Math.hypot(this.re, this.im);
    if (r === 0) return Complex.ZERO;
    const u = Math.sqrt((r + this.re) / 2);
    const v = Math.sign(this.im === 0 ? 1 : this.im) * Math.sqrt((r - this.re) / 2);
    return new Complex(u, v);
  }

  /**
   * Complex exponential: exp(z) = exp(re) * (cos(im) + i * sin(im))
   */
  exp(): Complex {
    const expRe = Math.exp(this.re);
    return new Complex(expRe * Math.cos(this.im), expRe * Math.sin(this.im));
  }

  /**
   * Complex cosine: cos(z) = (exp(iz) + exp(-iz)) / 2
   */
  cos(): Complex {
    // cos(a + ib) = cos(a)cosh(b) - i sin(a)sinh(b)
    const a = this.re;
    const b = this.im;
    const coshB = Math.cosh(b);
    const sinhB = Math.sinh(b);
    return new Complex(Math.cos(a) * coshB, -Math.sin(a) * sinhB);
  }

  /**
   * Complex sine: sin(z) = (exp(iz) - exp(-iz)) / (2i)
   */
  sin(): Complex {
    // sin(a + ib) = sin(a)cosh(b) + i cos(a)sinh(b)
    const a = this.re;
    const b = this.im;
    const coshB = Math.cosh(b);
    const sinhB = Math.sinh(b);
    return new Complex(Math.sin(a) * coshB, Math.cos(a) * sinhB);
  }

  toString(decimals: number = 4): string {
    const reStr = this.re.toFixed(decimals);
    const imSign = this.im >= 0 ? '+' : '-';
    const imStr = Math.abs(this.im).toFixed(decimals);
    return `${reStr} ${imSign} ${imStr}i`;
  }
}
