"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ================================================================
   HOOKS
   ================================================================ */

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting)
          el.querySelectorAll(".reveal").forEach((c) => c.classList.add("visible"));
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function AnimatedNum({ value, suffix = "", go }: { value: number; suffix?: string; go: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!go) return;
    const dur = 2000;
    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setN(Math.round((1 - Math.pow(1 - p, 3)) * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [go, value]);
  return <span className="font-mono tabular-nums">{n.toLocaleString()}{suffix}</span>;
}

/* ================================================================
   TOP-DOWN TRAIN — 22px wide to match track
   3 tall boxy cars trailing (top) + locomotive with rounded nose (bottom)
   ================================================================ */

function BulletTrain({ reverse = false, revealProgress = 1, tunnelProgress = 0 }: { reverse?: boolean; revealProgress?: number; tunnelProgress?: number }) {
  const headColor = reverse ? "#EF4444" : "#fff";
  const tailColor = reverse ? "#fff" : "#EF4444";
  const body = "#e5e5e5";
  const roof = "#d4d4d4";
  const win = "#bbb";
  const coupler = "#ccc";

  /* Boxy passenger car */
  const Car = ({ y }: { y: number }) => {
    const h = 52;
    const rows = 5;
    return (
      <g>
        <rect x="3" y={y} width="16" height={h} rx="2" fill={body} />
        <rect x="9" y={y} width="4" height={h} rx="1" fill={roof} />
        {Array.from({ length: rows }, (_, i) => (
          <g key={i}>
            <rect x="4" y={y + 6 + i * 9} width="3" height="4" rx="0.7" fill={win} opacity="0.45" />
            <rect x="15" y={y + 6 + i * 9} width="3" height="4" rx="0.7" fill={win} opacity="0.45" />
          </g>
        ))}
      </g>
    );
  };

  /* 10 cars (each 52px + 3px coupler = 55px stride) then locomotive ~75px
     Total: 10*55 + 75 = 625, round to 630 */
  const numCars = 10;
  const carH = 52;
  const gap = 3;
  const stride = carH + gap;
  const locoStart = numCars * stride;
  const locoH = 75;
  const totalH = locoStart + locoH + 5;

  // Each piece: loco = 0, last car = 1, ..., first car = numCars
  const totalPieces = numCars + 1;
  const pieceOpacity = (index: number) => {
    // Fade in: loco first (index 0), then cars bottom to top
    const inThreshold = index / totalPieces;
    const fadeIn = Math.max(0, Math.min(1, (revealProgress - inThreshold) / (1 / totalPieces)));
    // Fade out (tunnel): loco first (index 0), then cars bottom to top
    const outThreshold = index / totalPieces;
    const fadeOut = 1 - Math.max(0, Math.min(1, (tunnelProgress - outThreshold) / (1 / totalPieces)));
    return Math.min(fadeIn, fadeOut);
  };
  const locoOpacity = pieceOpacity(0);

  return (
    <svg width="22" height={totalH} viewBox={`0 0 22 ${totalH}`} fill="none">
      {/* === PASSENGER CARS === */}
      {Array.from({ length: numCars }, (_, i) => {
        const y = i * stride;
        // First car (i=0, top) fades last, last car (i=numCars-1, bottom) fades first after loco
        const op = pieceOpacity(numCars - i);
        return (
          <g key={i} opacity={op}>
            <Car y={y} />
            {/* Taillights on very first car */}
            {i === 0 && (
              <>
                <circle cx="6" cy={y + 3} r="1.2" fill={tailColor} />
                <circle cx="16" cy={y + 3} r="1.2" fill={tailColor} />
              </>
            )}
            {/* Coupler after each car */}
            <rect x="9" y={y + carH} width="4" height={gap} rx="1" fill={coupler} />
          </g>
        );
      })}

      {/* === LOCOMOTIVE — flat rear, rounded nose at bottom === */}
      <g opacity={locoOpacity}>
      <path
        d={`M3 ${locoStart} L19 ${locoStart} L19 ${locoStart + 42} C19 ${locoStart + 56} 17 ${locoStart + 66} 14 ${locoStart + 71} A4 4 0 0 1 8 ${locoStart + 71} C5 ${locoStart + 66} 3 ${locoStart + 56} 3 ${locoStart + 42} Z`}
        fill={body}
      />
      {/* Roof stripe */}
      <path
        d={`M9 ${locoStart} L13 ${locoStart} L13 ${locoStart + 55} C12.5 ${locoStart + 61} 11.5 ${locoStart + 66} 11 ${locoStart + 68} C10.5 ${locoStart + 66} 9.5 ${locoStart + 61} 9 ${locoStart + 55} Z`}
        fill={roof}
      />
      {/* Rear windshield */}
      <rect x="6" y={locoStart + 2} width="10" height="5" rx="1.5" fill={win} opacity="0.35" />
      {/* Side windows */}
      {[12, 20, 28, 36].map((off) => (
        <g key={off}>
          <rect x="4" y={locoStart + off} width="3" height="4" rx="0.7" fill={win} opacity="0.35" />
          <rect x="15" y={locoStart + off} width="3" height="4" rx="0.7" fill={win} opacity="0.35" />
        </g>
      ))}
      {/* Front windshield (rounded nose) */}
      <path
        d={`M6 ${locoStart + 46} L16 ${locoStart + 46} C16 ${locoStart + 54} 14 ${locoStart + 62} 11 ${locoStart + 67} C8 ${locoStart + 62} 6 ${locoStart + 54} 6 ${locoStart + 46} Z`}
        fill={win}
        opacity="0.3"
      />
      {/* Headlights */}
      <circle cx="7" cy={locoStart + 56} r="1.3" fill={headColor} />
      <circle cx="15" cy={locoStart + 56} r="1.3" fill={headColor} />

      {/* Shadow */}
      <ellipse cx="11" cy={totalH - 3} rx="5" ry="1.5" fill="#000" opacity="0.04" />
      </g>
    </svg>
  );
}

/* ================================================================
   NOTIFICATION BUBBLE
   ================================================================ */

function Notif({ title, body, time = "now" }: { title: string; body: string; time?: string }) {
  return (
    <div className="reveal notif w-full max-w-[380px]">
      <div className="flex items-center gap-2 mb-1">
        <img src="/tracky-logo.png" alt="" className="w-5 h-5 rounded-md" />
        <span className="text-[11px] text-black/30 font-medium">Tracky</span>
        <span className="text-[11px] text-black/20 ml-auto">{time}</span>
      </div>
      <p className="text-[13px] text-black/80 font-medium leading-snug">{title}</p>
      <p className="text-[12px] text-black/40 leading-snug mt-0.5">{body}</p>
    </div>
  );
}

/* ================================================================
   TRACK ROW
   ================================================================ */

function Row({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  const ref = useReveal();
  return (
    <div ref={ref} className="track-row">
      {side === "left" ? (
        <>
          <div className="track-left">{children}</div>
          <div />
          <div className="hidden md:block" />
        </>
      ) : (
        <>
          <div className="hidden md:block" />
          <div />
          <div className="track-right">{children}</div>
        </>
      )}
    </div>
  );
}

function PairRow({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    const lEl = leftRef.current;
    const rEl = rightRef.current;
    if (!el || !lEl || !rEl) return;

    const revealChildren = el.querySelectorAll(".reveal");

    const apply = (el2: HTMLElement, tx: number, ty: number, rot: number, fade: number) => {
      el2.style.opacity = String(fade);
      el2.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg)`;
    };

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const center = rect.top + rect.height / 2;
      const progress = 1 - center / vh;
      const mobile = window.innerWidth <= 768;

      // Off-screen — hidden
      if (rect.top > vh || rect.bottom < 0) {
        lEl.style.opacity = "0";
        rEl.style.opacity = "0";
        return;
      }

      // Trigger reveal children once
      if (!revealed.current && progress > 0.05) {
        revealed.current = true;
        revealChildren.forEach((c) => c.classList.add("visible"));
      }

      // On mobile, both sides swipe right (track is on the left)
      // On desktop, left swipes left, right swipes right
      const lDir = mobile ? 1 : -1;
      const rDir = 1;

      // Phase 1: fly IN (progress -0.1 to 0.35)
      if (progress < 0.35) {
        const t = Math.max(0, Math.min(1, (progress + 0.1) / 0.45));
        const eased = 1 - (1 - t) * (1 - t);
        const tx = (1 - eased) * 120;
        const ty = (1 - eased) * 60;
        const rot = (1 - eased) * 8;
        const fade = Math.min(1, t * 1.5);
        apply(lEl, -lDir * tx, ty, -lDir * rot, fade);
        apply(rEl, -rDir * tx, ty, -rDir * rot, fade);
        return;
      }

      // Phase 2: gentle drift (progress 0.35 to 0.75)
      if (progress < 0.75) {
        const drift = (progress - 0.35) / 0.4;
        const tx = drift * 5;
        const rot = drift * 1;
        apply(lEl, lDir * tx, 0, lDir * rot, 1);
        apply(rEl, rDir * tx, 0, rDir * rot, 1);
        return;
      }

      // Phase 3: rapid fly-OUT (progress 0.75 to 1.15)
      const exit = Math.min(1, (progress - 0.75) / 0.4);
      const eased = exit * exit;
      const tx = 5 + eased * 120;
      const ty = eased * -60;
      const rot = 1 + eased * 8;
      const fade = Math.max(0, 1 - exit * 1.5);
      apply(lEl, lDir * tx, ty, lDir * rot, fade);
      apply(rEl, rDir * tx, ty, rDir * rot, fade);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={ref} className="track-row">
      <div className="track-left"><div ref={leftRef} style={{ opacity: 0, willChange: "transform, opacity" }}>{left}</div></div>
      <div />
      <div className="track-right"><div ref={rightRef} style={{ opacity: 0, willChange: "transform, opacity" }}>{right}</div></div>
    </div>
  );
}

/* ================================================================
   PAGE
   ================================================================ */

/* ================================================================
   TYPEWRITER HOOK
   ================================================================ */

function useTypewriter(text: string, delay: number, speed: number) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      let i = 0;
      const iv = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(iv);
          setDone(true);
        }
      }, speed);
      return () => clearInterval(iv);
    }, delay);
    return () => clearTimeout(timeout);
  }, [text, delay, speed]);
  return { displayed, done };
}

/* ================================================================
   PAGE
   ================================================================ */

export default function Home() {
  const heroRef = useReveal();
  const moreRef = useReveal();
  const ctaRef = useReveal();
  const trackRef = useRef<HTMLElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const [statsGo, setStatsGo] = useState(false);
  const [trainVisible, setTrainVisible] = useState(false);
  const [scrollingUp, setScrollingUp] = useState(false);
  const [trainReveal, setTrainReveal] = useState(0);
  const [tunnelProgress, setTunnelProgress] = useState(0);
  const [hasScrolled, setHasScrolled] = useState(false);
  const lastScrollY = useRef(0);
  const notifRef = useRef<HTMLDivElement>(null);

  /* ---- Intro sequence stages ---- */
  const [introStage, setIntroStage] = useState(0);
  // 0 = nothing, 1 = typewriter started, 2 = desc visible, 3 = notif visible, 4 = track drawing, 5 = header visible
  const { displayed: titleText, done: titleDone } = useTypewriter("Tracky", 300, 80);

  useEffect(() => {
    // Stage 1: typewriter starts immediately (via hook delay)
    setIntroStage(1);
  }, []);

  useEffect(() => {
    if (titleDone) {
      // After typewriter finishes, show description
      const t1 = setTimeout(() => setIntroStage(2), 200);
      // Then notification drops in
      const t2 = setTimeout(() => setIntroStage(3), 900);
      // Then track draws in
      const t3 = setTimeout(() => setIntroStage(4), 1600);
      // Then header slides in
      const t4 = setTimeout(() => setIntroStage(5), 2800);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
    }
  }, [titleDone]);

  const handleScroll = useCallback(() => {
    const section = trackRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    setTrainVisible(rect.top < vh && rect.bottom > 0);

    const y = window.scrollY;
    setScrollingUp(y < lastScrollY.current);
    if (y > 50) setHasScrolled(true);
    lastScrollY.current = y;

    // Train car reveal: based on notification passing mid-screen
    const notif = notifRef.current;
    if (notif) {
      const nr = notif.getBoundingClientRect();
      const notifCenter = nr.top + nr.height / 2;
      const p = Math.max(0, Math.min(1, (vh / 2 - notifCenter + 100) / (vh * 1)));
      setTrainReveal(p);
    }

    // Tunnel fade-out: train is fixed at 50vh, track bottom approaches
    // When track section bottom is near 50vh, start fading out
    const distFromBottom = rect.bottom + 250;
    const tp = Math.max(0, Math.min(1, 1 - distFromBottom / (vh * 1)));
    setTunnelProgress(tp);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsGo(true); }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) el.querySelectorAll(".logo-enter").forEach((c) => c.classList.add("visible"));
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <main className="bg-white min-h-screen">

      {/* ===== FLOATING BUBBLE HEADER ===== */}
      <header className="fixed top-4 left-1/2 z-50 w-[92%] max-w-xl" style={{
        transition: "opacity 0.6s ease, transform 0.6s ease",
        opacity: introStage >= 5 ? 1 : 0,
        transform: introStage >= 5 ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(-30px)",
      }}>
        <div className="flex items-center justify-between px-5 h-12 rounded-full bg-white/70 backdrop-blur-xl border border-black/8 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-2">
            <img src="/tracky-logo.png" alt="Tracky" className="w-7 h-7 rounded-lg" />
            <span className="text-sm font-bold tracking-tight">Tracky</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#" className="hidden sm:inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-black text-white text-xs font-semibold transition-opacity hover:opacity-80">
              Download
            </a>
            <button className="flex flex-col gap-[4px] p-1.5" aria-label="Menu">
              <span className="block w-4 h-[1.5px] bg-black/50 rounded-full" />
              <span className="block w-4 h-[1.5px] bg-black/50 rounded-full" />
              <span className="block w-2.5 h-[1.5px] bg-black/50 rounded-full" />
            </button>
          </div>
        </div>
      </header>

      {/* ===== FIXED BULLET TRAIN — always at 50vh when track is in view ===== */}
      {trainVisible && (
        <div className="scroll-train">
          <BulletTrain reverse={scrollingUp} revealProgress={trainReveal} tunnelProgress={tunnelProgress} />
        </div>
      )}

      {/* ========== HERO ========== */}
      <section ref={heroRef} className="relative flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-bold tracking-tight leading-[1.05] max-w-3xl mb-8" style={{
          textWrap: "balance",
          filter: titleDone ? "blur(0px)" : "blur(4px)",
          transition: "filter 0.6s ease",
        }}>
          {titleText}
        </h1>
        <p className="text-black/45 text-lg md:text-xl max-w-xl mt-6 leading-relaxed" style={{
          textWrap: "balance",
          transition: "opacity 0.7s ease, transform 0.7s ease, filter 0.7s ease",
          opacity: introStage >= 2 ? 1 : 0,
          transform: introStage >= 2 ? "translateY(0)" : "translateY(10px)",
          filter: introStage >= 2 ? "blur(0px)" : "blur(6px)",
        }}>
          The only app that tells you everything about your train. Live map, real-time
          delays, departure boards, and weather&nbsp;&mdash; so you&apos;re always first to know.
        </p>
        <div ref={notifRef} className="mt-12 w-full max-w-md px-4 relative z-[11]" style={{
          transition: "opacity 0.6s ease, transform 0.6s ease",
          opacity: introStage >= 3 ? 1 : 0,
          transform: introStage >= 3 ? "translateY(0)" : "translateY(20px)",
        }}>
          <div className="relative">
            <div style={{
              transition: "opacity 0.6s ease, transform 0.6s ease",
              opacity: hasScrolled ? 0.45 : 1,
              transform: hasScrolled ? "translateY(-18px) scale(0.92)" : "translateY(0) scale(1)",
              transformOrigin: "top center",
              pointerEvents: hasScrolled ? "none" : "auto",
            }}>
              <Notif title="Acela 2151 — Delayed 12m" body="New departure 6:17 AM from BOS. Late inbound equipment." time="5:48 AM" />
            </div>
            <div className="absolute inset-0" style={{
              transition: "opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s",
              opacity: hasScrolled ? 1 : 0,
              transform: hasScrolled ? "translateY(0)" : "translateY(12px)",
            }}>
              <Notif title="Acela 2151 — Now On Time" body="Schedule restored. Departing 6:05 AM from BOS as planned." time="5:52 AM" />
            </div>
          </div>
        </div>
        {/* Track fading up into the notification — animated on intro */}
        <div className="hero-track-leadin" style={{
          opacity: introStage >= 4 ? 1 : 0,
        }}>
          {/* Ties — draw in left-to-right, staggered top to bottom */}
          <div className="absolute top-0 bottom-0 left-0 right-0 overflow-hidden">
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i} className="absolute left-0 right-0 h-[2px]" style={{
                top: `${18 + i * 20}px`,
                background: "#e0e0e0",
                transition: `opacity 0.3s ease ${i * 40}ms, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${i * 40}ms`,
                opacity: introStage >= 4 ? 1 : 0,
                transform: introStage >= 4 ? "scaleX(1)" : "scaleX(0)",
                transformOrigin: "left center",
              }} />
            ))}
          </div>
          {/* Rails — slide in top to bottom after ties */}
          <div className="absolute top-0 bottom-0 left-[2px] w-[2px] bg-[#d4d4d4]" style={{
            transition: "clip-path 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s",
            clipPath: introStage >= 4 ? "inset(0 0 0 0)" : "inset(0 0 100% 0)",
          }} />
          <div className="absolute top-0 bottom-0 right-[2px] w-[2px] bg-[#d4d4d4]" style={{
            transition: "clip-path 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.7s",
            clipPath: introStage >= 4 ? "inset(0 0 0 0)" : "inset(0 0 100% 0)",
          }} />
        </div>
      </section>


      {/* ========== TRACK SECTION ========== */}
      <section ref={trackRef} className="relative pt-16 pb-0">
        <div className="track-spine hidden md:block"><div className="track-ties" /></div>
        <div className="track-spine-mobile md:hidden"><div className="track-ties" /></div>

        {/* ---- SEARCH & SAVE ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full space-y-3">
              <Notif title="Acela 2151 — Saved" body="BOS → WAS · Departs 6:05 AM tomorrow" time="9:12 PM" />
              <Notif title="Calendar sync found 1 trip" body="Imported Acela 2151 on Mar 15 from your calendar" time="9:12 PM" />
            </div>
          }
          right={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">Preflight</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">Find your train in seconds</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                Search by train number, route name, or station. Two-station trip search
                finds every option on any date. Save with one tap&nbsp;&mdash; Tracky
                remembers across sessions.
              </p>
            </div>
          }
        />


        {/* ---- COUNTDOWN ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">Departure day</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">A countdown to every moment</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                Wake up to a live countdown. Your saved train front and center
                with real-time status. Know the second something changes&nbsp;&mdash;
                before Amtrak posts it.
              </p>
            </div>
          }
          right={
            <div className="max-w-sm w-full">
              <div className="reveal app-card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-lg font-bold text-white">Acela 2151</p>
                    <p className="text-white/40 text-xs">Boston → Washington</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-[#10B981]/15 st-ok font-medium">On Time</span>
                </div>
                <div className="flex items-center justify-between mb-5">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">BOS</p>
                    <p className="text-white/30 text-xs mt-0.5">6:05 AM</p>
                  </div>
                  <div className="flex-1 mx-5 flex items-center">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="px-2 text-white/20 text-xs">6h 45m</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">WAS</p>
                    <p className="text-white/30 text-xs mt-0.5">12:50 PM</p>
                  </div>
                </div>
                <div className="app-card-inner text-center py-4">
                  <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Departs in</p>
                  <p className="text-4xl font-mono font-bold tracking-wide text-white">1:58:32</p>
                </div>
              </div>
            </div>
          }
        />


        {/* ---- DEPARTURE BOARD ---- */}
        <PairRow
          left={
            <div className="max-w-md w-full">
              <div className="reveal app-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" style={{ animation: "pulse-soft 2s infinite" }} />
                    <span className="text-[11px] font-mono text-white/30 uppercase tracking-wider">Departures — BOS</span>
                  </div>
                  <span className="text-[11px] text-white/20 font-mono">Today</span>
                </div>
                {[
                  { n: "171",  r: "NE Regional", t: "6:10 AM", s: "On Time", c: "st-ok" },
                  { n: "2151", r: "Acela",       t: "6:05 AM", s: "On Time", c: "st-ok", hl: true },
                  { n: "85",   r: "NE Regional", t: "7:00 AM", s: "+5 min",  c: "st-warn" },
                  { n: "95",   r: "Vermonter",   t: "7:15 AM", s: "On Time", c: "st-ok" },
                  { n: "2153", r: "Acela",       t: "8:00 AM", s: "On Time", c: "st-ok" },
                ].map((t) => (
                  <div
                    key={t.n}
                    className="board-row"
                    style={t.hl ? { background: "rgba(255,255,255,0.04)", border: "1px solid #3A3A3F", borderRadius: 8 } : undefined}
                  >
                    <span className="board-cell text-white/70 font-semibold text-center">{t.n}</span>
                    <span className="text-[13px] text-white/40 truncate">{t.r}</span>
                    <span className="board-cell text-white/50 text-right">{t.t}</span>
                    <span className={`text-[12px] font-medium text-right ${t.c}`}>{t.s}</span>
                  </div>
                ))}
              </div>
            </div>
          }
          right={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">At the station</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">Every station. Every train. Live.</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                Pull up the departure board for any of 500+ Amtrak stations.
                Filter arrivals and departures, browse future dates, and
                swipe any train to save&nbsp;&mdash; right from the board.
              </p>
            </div>
          }
        />


        {/* ---- LIVE MAP ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">All aboard</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">Watch your train. In real time.</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                A full-screen map with every active Amtrak train in the country.
                Positions update every 15 seconds from live GTFS-RT data.
                Color-coded routes and smart station clustering.
              </p>
            </div>
          }
          right={
            <div className="max-w-md w-full">
              <div className="reveal map-frame aspect-[4/3]">
                <svg viewBox="0 0 480 360" fill="none" className="w-full h-full">
                  <rect width="480" height="360" fill="#18181B" />
                  {[60,120,180,240,300].map(y => <line key={`h${y}`} x1="0" y1={y} x2="480" y2={y} stroke="#2C2C30" strokeWidth="0.5" />)}
                  {[80,160,240,320,400].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="360" stroke="#2C2C30" strokeWidth="0.5" />)}
                  <path d="M420 60 Q400 80 390 120 Q380 160 360 180 Q340 200 300 220 Q260 240 220 260 Q180 270 140 280 Q100 285 60 290 L60 360 L480 360 L480 60 Z" fill="#1D1D1F" />
                  <path d="M380 100 Q350 130 320 160 Q290 185 250 210 Q220 230 180 250" stroke="#FF6B35" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.6" />
                  <circle cx="380" cy="100" r="4" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.4" />
                  <circle cx="320" cy="160" r="3" fill="none" stroke="#fff" strokeWidth="1" opacity="0.2" />
                  <circle cx="250" cy="210" r="3" fill="none" stroke="#fff" strokeWidth="1" opacity="0.2" />
                  <circle cx="180" cy="250" r="4" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.4" />
                  <circle r="5" fill="#fff">
                    <animateMotion dur="6s" repeatCount="indefinite" path="M380 100 Q350 130 320 160 Q290 185 250 210 Q220 230 180 250" />
                  </circle>
                  <circle r="14" fill="#fff" opacity="0.08">
                    <animateMotion dur="6s" repeatCount="indefinite" path="M380 100 Q350 130 320 160 Q290 185 250 210 Q220 230 180 250" />
                    <animate attributeName="r" values="8;16;8" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <text x="380" y="90" fill="#fff" fontSize="9" textAnchor="middle" opacity="0.4" fontFamily="var(--font-mono)">BOS</text>
                  <text x="320" y="150" fill="#fff" fontSize="8" textAnchor="middle" opacity="0.25" fontFamily="var(--font-mono)">NHV</text>
                  <text x="250" y="200" fill="#fff" fontSize="8" textAnchor="middle" opacity="0.25" fontFamily="var(--font-mono)">NYP</text>
                  <text x="180" y="268" fill="#fff" fontSize="9" textAnchor="middle" opacity="0.4" fontFamily="var(--font-mono)">WAS</text>
                </svg>
              </div>
            </div>
          }
        />


        {/* ---- EN ROUTE ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full">
              <div className="reveal app-card">
                <div className="flex gap-2 mb-4">
                  {[
                    { v: "124", l: "mph" },
                    { v: "SW", l: "bearing" },
                    { v: "0m", l: "delay", cls: "st-ok" },
                  ].map((d) => (
                    <div key={d.l} className="flex-1 app-card-inner text-center">
                      <p className={`text-xl font-mono font-bold text-white ${d.cls || ""}`}>{d.v}</p>
                      <p className="text-[9px] text-white/25 uppercase">{d.l}</p>
                    </div>
                  ))}
                </div>
                {[
                  { stop: "Boston South", t: "6:05 AM", s: "departed" },
                  { stop: "Providence",   t: "6:40 AM", s: "departed" },
                  { stop: "New Haven",    t: "7:55 AM", s: "current" },
                  { stop: "New York Penn",t: "9:10 AM", s: "upcoming" },
                  { stop: "Philadelphia", t: "10:25 AM",s: "upcoming" },
                  { stop: "Washington",   t: "12:50 PM",s: "upcoming" },
                ].map((r, i, arr) => (
                  <div key={i} className="flex items-start gap-3 py-1.5">
                    <div className="flex flex-col items-center w-3 mt-1">
                      <div className={`w-2.5 h-2.5 rounded-full border-[1.5px] ${
                        r.s === "departed" ? "bg-white/20 border-white/20" :
                        r.s === "current"  ? "bg-white border-white" :
                        "bg-transparent border-white/15"
                      }`} style={r.s === "current" ? { boxShadow: "0 0 8px rgba(255,255,255,0.3)" } : undefined} />
                      {i < arr.length - 1 && <div className={`w-px h-3 mt-0.5 ${r.s === "departed" ? "bg-white/10" : "bg-white/5"}`} />}
                    </div>
                    <span className={`text-[13px] flex-1 ${
                      r.s === "current"  ? "text-white font-medium" :
                      r.s === "departed" ? "text-white/25" : "text-white/50"
                    }`}>{r.stop}</span>
                    <span className={`text-[12px] font-mono ${r.s === "current" ? "text-white" : "text-white/20"}`}>{r.t}</span>
                  </div>
                ))}
              </div>
            </div>
          }
          right={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">En route</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">Every stop. Every delay. Every mile.</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                Full itinerary updating in real time. Speed, bearing,
                per-stop delay&nbsp;&mdash; early, on time, or late by exactly how many
                minutes. Tap any station to open its departure board.
              </p>
            </div>
          }
        />


        {/* ---- DELAYS ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">Delays</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">Know before Amtrak does</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                Live GTFS-RT delay data for every stop along the route. The moment
                a delay is reported, you see it&nbsp;&mdash; often minutes before the
                official app catches up.
              </p>
            </div>
          }
          right={
            <div className="max-w-sm w-full space-y-3">
              <Notif title="Acela 2151 — Delayed 12m" body="Late equipment from previous service. New departure: 6:17 AM." time="5:48 AM" />
              <Notif title="Acela 2151 — Back on schedule" body="Made up time after Providence. ETA 12:50 PM at WAS." time="7:22 AM" />
            </div>
          }
        />


        {/* ---- WEATHER ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full">
              <div className="reveal app-card text-center py-8">
                <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Washington, DC</p>
                <div className="flex items-center justify-center gap-4 mb-4">
                  <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="10" fill="#FF6B35" opacity="0.15" />
                    <circle cx="24" cy="24" r="8" stroke="#FF6B35" strokeWidth="1.5" opacity="0.6" />
                    {[0,45,90,135,180,225,270,315].map((a) => {
                      const r2 = (a * Math.PI) / 180;
                      return <line key={a} x1={24+14*Math.cos(r2)} y1={24+14*Math.sin(r2)} x2={24+18*Math.cos(r2)} y2={24+18*Math.sin(r2)} stroke="#FF6B35" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />;
                    })}
                  </svg>
                  <span className="text-5xl font-light text-white">72°</span>
                </div>
                <p className="text-white/40 text-sm">Partly cloudy</p>
                <div className="flex justify-center gap-6 mt-6 text-xs text-white/25">
                  {[["1 PM","74°"],["2 PM","73°"],["3 PM","70°"],["4 PM","67°"]].map(([t,d]) => (
                    <div key={t}><p className="text-white/40 font-mono">{t}</p><p>{d}</p></div>
                  ))}
                </div>
              </div>
            </div>
          }
          right={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">Almost there</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">What&apos;s waiting for you</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                As you approach your destination, check the weather forecast&nbsp;&mdash;
                temperature, conditions, hourly breakdown. Fahrenheit or Celsius.
              </p>
            </div>
          }
        />


        {/* ---- ARRIVED ---- */}
        <PairRow
          left={
            <div className="max-w-sm w-full">
              <p className="reveal text-xs font-mono text-black/25 uppercase tracking-[0.2em] mb-3">Arrived</p>
              <h3 className="reveal text-2xl md:text-3xl font-bold mb-3">A hall of fame for your&nbsp;travels</h3>
              <p className="reveal reveal-d1 text-black/45 leading-relaxed">
                Every completed trip is automatically archived. Browse your
                history, see lifetime stats, and share beautiful ticket art.
              </p>
            </div>
          }
          right={
            <div className="max-w-md w-full">
              <div className="reveal ticket px-6 py-5">
                <div className="ticket-hole-l" /><div className="ticket-hole-r" />
                <p className="text-[10px] font-mono text-white/20 uppercase tracking-[0.15em] mb-3">Tracky Boarding Pass</p>
                <div className="flex items-center justify-between mb-4">
                  <div><p className="text-3xl font-bold text-white">BOS</p><p className="text-[11px] text-white/30 mt-0.5">Boston</p></div>
                  <div className="flex-1 mx-6 flex items-center">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="px-3 text-white/20 text-lg">→</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <div className="text-right"><p className="text-3xl font-bold text-white">WAS</p><p className="text-[11px] text-white/30 mt-0.5">Washington</p></div>
                </div>
                <div className="h-px my-4" style={{ borderTop: "1px dashed rgba(255,255,255,0.1)" }} />
                <div className="grid grid-cols-3 gap-4">
                  {[["Train","Acela 2151"],["Duration","6h 45m"],["Distance","457 mi"]].map(([l,v]) => (
                    <div key={l}><p className="text-[9px] text-white/20 uppercase tracking-wider">{l}</p><p className="text-sm font-semibold text-white mt-0.5">{v}</p></div>
                  ))}
                </div>
              </div>
            </div>
          }
        />

      </section>
      {/* ---- TUNNEL AT END OF TRACK ---- */}
      <div className="relative flex justify-center -mt-12" style={{ zIndex: 11 }}>
        <div className="tunnel-end" style={{
          transform: `scale(${tunnelProgress > 0.01 ? 1 + 0.3 * Math.exp(-((tunnelProgress * 11) % 1) * 4) : 1})`,
          transition: "transform 0.1s ease-out",
        }} />
      </div>
      {/* White cover to hide train overshooting past tunnel */}
      <div className="relative bg-white" style={{ zIndex: 11 }}>

      {/* ========== STATS ========== */}
      <section ref={statsRef} className="py-24 px-6">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-8 text-center">
          {[
            { v: tunnelProgress > 0.3 ? 47 : 46, s: "", l: "Trips" },
            { v: 12849 + Math.round(tunnelProgress * 457), s: " mi", l: "Distance" },
            { v: 186 + Math.round(tunnelProgress * 7), s: " hr", l: "On Rails" },
          ].map((d) => (
            <div key={d.l}>
              <p className="text-4xl md:text-5xl font-bold whitespace-nowrap"><span className="font-mono tabular-nums">{d.v.toLocaleString()}{d.s}</span></p>
              <p className="text-black/25 text-xs uppercase tracking-widest mt-2 whitespace-nowrap">{d.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ========== MORE FEATURES ========== */}
      <section ref={moreRef} className="py-24 px-6 max-w-5xl mx-auto">
        <h2 className="reveal text-3xl md:text-4xl font-bold text-center mb-16">And so much more.</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { t: "iOS Live Activity", d: "Glanceable train status on your lock screen and Dynamic Island." },
            { t: "Calendar sync", d: "Scan your calendar for Amtrak trips and auto-import them." },
            { t: "Share trips", d: "Share completed trips as beautiful ticket art images." },
            { t: "Map views", d: "Toggle satellite and standard. See your GPS location alongside trains." },
            { t: "Smart clustering", d: "Hundreds of stations that cluster and uncluster as you zoom." },
            { t: "Privacy first", d: "Your saved trains and travel history stay on your device." },
          ].map((f, i) => (
            <div key={i} className="reveal feat-card" style={{ transitionDelay: `${i * 50}ms` }}>
              <h3 className="text-base font-semibold mb-1.5">{f.t}</h3>
              <p className="text-black/40 text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section ref={ctaRef} className="py-32 px-6 text-center relative">
        <div className="mx-auto flex justify-center mb-6">
          <div className="w-[28px] h-24 relative">
            <div className="absolute top-0 bottom-0 left-[4px] w-[2px] bg-gradient-to-b from-transparent to-[#d4d4d4]" />
            <div className="absolute top-0 bottom-0 right-[4px] w-[2px] bg-gradient-to-b from-transparent to-[#d4d4d4]" />
          </div>
        </div>
        <div className="reveal max-w-xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-bold mb-6" style={{ textWrap: "balance" }}>
            Your next ride starts with Tracky
          </h2>
          <p className="text-black/40 text-lg mb-10 leading-relaxed">Real-time tracking for every Amtrak train. Free to download.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#" className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full bg-black text-white font-semibold text-sm transition-opacity hover:opacity-80">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
              App Store
            </a>
            <a href="#" className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-full border border-black/15 text-black font-semibold text-sm transition-all hover:bg-black/[0.03]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-1.4l2.834 1.64a1 1 0 0 1 0 1.726l-2.834 1.64-2.536-2.536 2.536-2.47zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z"/></svg>
              Google Play
            </a>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer ref={footerRef} className="border-t border-black/8 pt-16 pb-10 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
            <div className="col-span-2 md:col-span-1">
              <div className="logo-enter flex items-center gap-2.5 mb-2">
                <img src="/tracky-logo.png" alt="Tracky" className="w-9 h-9 rounded-xl" />
                <p className="text-lg font-bold">Tracky</p>
              </div>
              <p className="text-black/40 text-sm leading-relaxed">Real-time Amtrak tracking for iOS&nbsp;&amp;&nbsp;Android.</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-black/30 mb-3">Product</p>
              <ul className="space-y-2 text-sm text-black/50">
                <li><a href="#" className="hover:text-black transition-colors">Live Map</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Departure Boards</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Train Tracking</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Travel History</a></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-black/30 mb-3">Resources</p>
              <ul className="space-y-2 text-sm text-black/50">
                <li><a href="#" className="hover:text-black transition-colors">About</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-black/30 mb-3">Download</p>
              <ul className="space-y-2 text-sm text-black/50">
                <li><a href="#" className="hover:text-black transition-colors">App Store</a></li>
                <li><a href="#" className="hover:text-black transition-colors">Google Play</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-black/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-black/25">&copy; {new Date().getFullYear()} Tracky. All rights reserved.</p>
            <div className="flex items-center gap-5">
              <a href="#" className="text-black/20 hover:text-black transition-colors" aria-label="Twitter">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="#" className="text-black/20 hover:text-black transition-colors" aria-label="GitHub">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              </a>
              <a href="#" className="text-black/20 hover:text-black transition-colors" aria-label="Instagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
      </div>{/* close white cover */}
    </main>
  );
}
