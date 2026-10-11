// =============================================================================
// Host-side tests for the LED logic (layout, targets, effects, countdown).
// Runs on a PC — no ESP32 needed. See test_host/README.md.
// =============================================================================
#include "Arduino.h"
#include "led/Color.h"
#include "led/ArenaLayout.h"
#include "led/LedEngine.h"

static int failures = 0, checks = 0;
#define CHECK(cond) do { checks++; if (!(cond)) { failures++; \
    printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } } while (0)

static bool same(const RGB& a, const RGB& b) { return a == b; }
static const RGB RED(255, 0, 0), GREEN(0, 255, 0), BLACK(0, 0, 0);

static void testColor() {
    RGB c;
    CHECK(color::parse("#ff8000", c) && same(c, RGB(255, 128, 0)));
    CHECK(color::parse("0f0", c) && same(c, RGB(0, 255, 0)));
    CHECK(color::parse("Red", c) && same(c, RED));
    CHECK(!color::parse("#12345", c));
    CHECK(!color::parse("nope", c));
    char hex[8]; color::toHex(RGB(1, 2, 255), hex);
    CHECK(strcmp(hex, "#0102ff") == 0);
    CHECK(color::breath8(0) == 0 && color::breath8(128) > 250);
}

static void testLayout(ArenaLayout& L) {
    L.setDefaults();
    CHECK(L.numSections() == 8);
    CHECK(L.total() == 72);
    CHECK(L.start(1) == 12 && L.count(1) == 6);           // edge_ne after ceil_n
    CHECK(L.outputCount(0) == 72 && L.outputCount(1) == 0);

    SectionMask m; const char* err = nullptr;
    JsonDocument d;
    d["t"] = "ceiling";
    CHECK(L.resolve(d["t"], m, err) && L.pixelsIn(m) == 48);
    d["t"] = "edges";
    CHECK(L.resolve(d["t"], m, err) && L.pixelsIn(m) == 24);
    d["t"] = "ceil_n, edge_ne";
    CHECK(L.resolve(d["t"], m, err) && m == 0b11);
    d["t"] = "red";
    CHECK(L.resolve(d["t"], m, err) && L.pixelsIn(m) == 24);
    d["t"] = "all";
    CHECK(L.resolve(d["t"], m, err) && m == L.allMask());
    CHECK(L.resolve(d["missing"], m, err) && m == L.allMask());   // null → all
    d["t"] = "bogus";
    CHECK(!L.resolve(d["t"], m, err));
    JsonDocument arr; arr.add("ceil_s"); arr.add("blue");
    CHECK(L.resolve(arr.as<JsonVariantConst>(), m, err) && L.pixelsIn(m) == 12 + 24);

    // Custom layout: two outputs + reversed section
    JsonDocument j;
    deserializeJson(j, R"({"sections":[{"name":"A1","count":5},{"name":"b1","count":3,"out":1,"rev":true},
        {"name":"a2","count":4}],"groups":[{"name":"left","sections":["a1","b1"]}]})");
    CHECK(L.fromJson(j.as<JsonObjectConst>(), err));
    CHECK(L.total() == 12 && L.outputCount(0) == 9 && L.outputCount(1) == 3);
    CHECK(L.outputPos(2) == 5);                            // a2 follows a1 on output A
    CHECK(L.findSection("a1") == 0);                       // names lower-cased
    CHECK(L.findGroup("left") == 0 && L.group(0).mask == 0b011);

    // Rejections leave the layout untouched
    const char* bad[] = {
        R"({"sections":[]})",
        R"({"sections":[{"name":"x","count":0}]})",
        R"({"sections":[{"name":"x","count":1,"out":2}]})",
        R"({"sections":[{"name":"x","count":1},{"name":"X","count":1}]})",
        R"({"sections":[{"name":"bad name","count":1}]})",
        R"({"sections":[{"name":"all","count":1}]})",
        R"({"sections":[{"name":"x","count":601}]})",
        R"({"sections":[{"name":"x","count":1}],"groups":[{"name":"x","sections":[]}]})",
        R"({"sections":[{"name":"x","count":1}],"groups":[{"name":"g","sections":["nope"]}]})",
    };
    for (const char* b : bad) {
        JsonDocument jb; deserializeJson(jb, b);
        err = nullptr;
        CHECK(!L.fromJson(jb.as<JsonObjectConst>(), err) && err);
        CHECK(L.total() == 12);
    }

    // toJson round-trip
    JsonDocument out;
    L.toJson(out.to<JsonObject>());
    CHECK(strcmp(out["sections"][0]["name"] | "", "a1") == 0);
    CHECK(out["sections"][1]["rev"] == true && out["total"] == 12);
    CHECK(strcmp(out["groups"][0]["sections"][1] | "", "b1") == 0);
    L.setDefaults();
}

static void testEngine(ArenaLayout& L) {
    LedEngine E;
    E.begin(&L);
    const SectionMask all = L.allMask();
    const RGB* f = E.frame();
    std::string ticks;
    E.onCountdown([&](int s) { ticks += std::to_string(s); });

    // Base fill
    E.fill(all, GREEN);
    E.render(0);
    CHECK(same(f[0], GREEN) && same(f[71], GREEN));

    // Countdown 3 s, warn ≤ 2 s, GO flash 2000 ms, then green
    SectionMask m; const char* err; JsonDocument d; d["t"] = "all"; L.resolve(d["t"], m, err);
    Effect cd;
    cd.type = Fx::Countdown; cd.mask = all; cd.c1 = RED;
    cd.cdTotalMs = 3000; cd.cdWarnMs = 2000; cd.cdGoMs = 2000;
    cd.cdWarn = RGB(255, 106, 0); cd.cdGo = GREEN; cd.cdHasThen = true; cd.cdThen = GREEN;
    E.fill(all, BLACK);
    E.addEffect(cd, 1000);
    E.render(1000);  CHECK(same(f[5], RED));                // 3 s left → red
    E.render(1999);  CHECK(same(f[5], RED));
    E.render(2000);  CHECK(same(f[5], RGB(255, 106, 0)));   // 2 s left → orange
    E.render(3500);  CHECK(same(f[5], RGB(255, 106, 0)));   // 1 s left → orange
    E.render(4000);  CHECK(same(f[5], GREEN));              // GO, flash on
    E.render(4160);  CHECK(same(f[5], BLACK));              // flash off
    E.render(4310);  CHECK(same(f[5], GREEN));              // flash on
    CHECK(E.animating());
    E.render(6000);  CHECK(same(f[5], GREEN));              // settled into "then"
    CHECK(!E.animating());
    E.render(6100);  CHECK(same(f[5], GREEN));              // base now green
    CHECK(ticks == "3210-1");

    // Overlay fault blink on the red side for 3 s, then back to green
    d["t"] = "red"; SectionMask red; L.resolve(d["t"], red, err);
    int redPx = L.start(L.findSection("ceil_w")), bluePx = L.start(L.findSection("ceil_e"));
    Effect fb; fb.type = Fx::Blink; fb.mask = red; fb.overlay = true;
    fb.c1 = RGB(255, 200, 0); fb.c2 = BLACK; fb.periodMs = 300; fb.durationMs = 3000;
    E.addEffect(fb, 10000);
    E.render(10010); CHECK(same(f[redPx], RGB(255, 200, 0)) && same(f[bluePx], GREEN));
    E.render(10160); CHECK(same(f[redPx], BLACK));
    E.render(13000); CHECK(same(f[redPx], GREEN));          // expired → base again
    CHECK(!E.animating());

    // A base effect replaces an overlapping one; fill cancels effects
    Effect rb; rb.type = Fx::Rainbow; rb.mask = all; rb.periodMs = 5000;
    E.addEffect(rb, 20000);
    Effect ch; ch.type = Fx::Chase; ch.mask = red; ch.c1 = RED; ch.c2 = BLACK;
    E.addEffect(ch, 20000);                                  // trims red sections out of rainbow
    E.render(20100);
    CHECK(E.animating());
    E.fill(all, BLACK);
    CHECK(!E.animating());

    // Overlay does NOT trim what's below
    E.addEffect(rb, 21000);
    Effect ov = fb; ov.durationMs = 0;
    E.addEffect(ov, 21000);
    JsonDocument sj; E.toJson(sj.to<JsonObject>(), 21000);
    CHECK(sj["effects"].size() == 2 && sj["countdown"].isNull());
    E.cancel(all);
    CHECK(!E.animating());

    // Slots: adding more than LED_MAX_EFFECTS overlays drops the oldest
    for (int i = 0; i < LED_MAX_EFFECTS + 3; i++) E.addEffect(ov, 22000 + i);
    JsonDocument sj2; E.toJson(sj2.to<JsonObject>(), 22100);
    CHECK(sj2["effects"].size() == LED_MAX_EFFECTS);
    E.cancel(all);

    // Progress + per-pixel effects on a 1-pixel target don't divide by zero
    JsonDocument j; const char* e2;
    deserializeJson(j, R"({"sections":[{"name":"one","count":1},{"name":"many","count":10}]})");
    CHECK(L.fromJson(j.as<JsonObjectConst>(), e2));
    E.reset();
    Effect pr; pr.type = Fx::Progress; pr.mask = 0b10; pr.value = 500; pr.c1 = RED; pr.c2 = BLACK;
    E.addEffect(pr, 0); E.render(5);
    CHECK(same(f[1], RED) && same(f[5], RED) && same(f[6], BLACK));
    for (Fx fx : {Fx::Rainbow, Fx::Chase, Fx::Sparkle, Fx::Identify, Fx::Breathe}) {
        Effect x; x.type = fx; x.mask = 0b01; x.periodMs = 20;
        E.addEffect(x, 0);
        for (uint32_t t = 0; t < 200; t += 7) E.render(t);
    }
    CHECK(true);

    // setPixels touching a section cancels effects only there
    E.reset();
    E.addEffect(rb, 0);                    // rb.mask is the old 8-section mask; trimmed to valid bits below
    E.cancel(0xFFFF);
    Effect p2 = pr; p2.mask = 0b11; E.addEffect(p2, 0);
    uint8_t px[3] = {1, 2, 3};
    E.setPixels(0, px, 1);                 // touches section "one" only
    E.render(10);
    CHECK(same(f[0], RGB(1, 2, 3)));
    CHECK(E.animating());                  // progress survives on "many"
    L.setDefaults();
}

int main() {
    ArenaLayout L;
    testColor();
    testLayout(L);
    testEngine(L);
    printf("%d checks, %d failures\n", checks, failures);
    return failures ? 1 : 0;
}
