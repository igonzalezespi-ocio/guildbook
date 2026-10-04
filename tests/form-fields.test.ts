import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { humanizeField } from "@/components/action-form";
import { createAnniversaryGuild, createForeverGuild, guildSettingsInput } from "@/lib/validation";

vi.mock("@/server/actions/platform", () => ({ checkSlugAction: vi.fn(), createGuildAction: vi.fn() }));

const { CREATE_GUILD_LABELS, CreateGuildForm } = await import("@/app/platform/create/create-guild-form");
const { GUILD_SETTINGS_LABELS, GuildSettingsForm } = await import("@/app/[guild]/admin/guild/settings-form");

/** Every field the server validates needs an input, an inline error slot and a summary label in its form. */
function expectFieldsCovered(markup: string, fields: string[], labels: Record<string, string>) {
  for (const field of fields) {
    expect(markup, `${field} input`).toMatch(new RegExp(`<(input|select|textarea)[^>]*name="${field}"`));
    expect(markup, `${field} error slot`).toContain(`data-error-slot="${field}"`);
    expect(labels[field], `${field} label`).toBeTruthy();
  }
}

describe("server-validated fields have somewhere to show their errors", () => {
  it("covers every createGuildInput field in the create form, for each game version", () => {
    const forever = renderToStaticMarkup(createElement(CreateGuildForm, { hostPrefix: "", hostSuffix: ".guildbook.io" }));
    expectFieldsCovered(forever, Object.keys(createForeverGuild.in.shape), CREATE_GUILD_LABELS);
    expect(forever).not.toContain('name="realmSlug"');
    const anniversary = renderToStaticMarkup(
      createElement(CreateGuildForm, { hostPrefix: "", hostSuffix: ".guildbook.io", initialVersion: "anniversary" }),
    );
    expectFieldsCovered(anniversary, Object.keys(createAnniversaryGuild.in.shape), CREATE_GUILD_LABELS);
    expect(anniversary).not.toContain('name="ruleset"');
  });

  it("covers every guildSettingsInput field in the guild settings form", () => {
    const markup = renderToStaticMarkup(
      createElement(GuildSettingsForm, {
        action: vi.fn(),
        guild: {
          name: "Silver Dawn",
          motto: null,
          description: "",
          timezone: "America/New_York",
          gameVersion: "forever",
          realmSlug: null,
          region: "us",
          faction: "alliance",
          ruleset: "normal",
          discordInviteUrl: null,
          recruitmentOpen: true,
          directoryListed: false,
          lootPublic: false,
          verifiedAt: null,
        },
      }),
    );
    expectFieldsCovered(
      markup,
      Object.keys(guildSettingsInput.shape).filter((f) => f !== "realmSlug"),
      GUILD_SETTINGS_LABELS,
    );
  });

  it("covers the realm instead of the ruleset for a guild on a realm", () => {
    const markup = renderToStaticMarkup(
      createElement(GuildSettingsForm, {
        action: vi.fn(),
        guild: {
          name: "Mirkwood",
          motto: null,
          description: "",
          timezone: "America/New_York",
          gameVersion: "anniversary",
          realmSlug: "dreamscythe",
          region: "us",
          faction: "horde",
          ruleset: "normal",
          discordInviteUrl: null,
          recruitmentOpen: true,
          directoryListed: false,
          lootPublic: false,
          verifiedAt: null,
        },
      }),
    );
    expectFieldsCovered(
      markup,
      Object.keys(guildSettingsInput.shape).filter((f) => f !== "ruleset"),
      GUILD_SETTINGS_LABELS,
    );
    expect(markup).not.toContain('name="ruleset"');
  });

  it("humanizes fields a form didn't label", () => {
    expect(humanizeField("discordInviteUrl")).toBe("Invitación de Discord");
    expect(humanizeField("region")).toBe("Región");
    expect(humanizeField("someOtherField")).toBe("Some other field");
  });
});
