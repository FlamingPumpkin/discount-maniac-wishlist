import type { CollectionOptions } from "@terminus-ai/app-sdk";

const itemsCollectionOptions = {
  indexes: ["type", "completed", "deal_alert"],
  searchFields: ["title", "notes", "price_summary"],
  schema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 300 },
      type: { type: "string", enum: ["todo", "tobuy", "wishlist"] },
      icon: { type: "string", maxLength: 32 },
      wiki_title: { type: "string", maxLength: 120 },
      commons_query: { type: "string", maxLength: 150 },
      img: { type: "string", maxLength: 1000 },
      price_summary: { type: "string", maxLength: 150 },
      deal_alert: { type: "boolean" },
      deal_badge: { type: "string", maxLength: 120 },
      pricing: {
        type: "object",
        properties: {
          official: { type: "string", maxLength: 200 },
          current_best: { type: "string", maxLength: 300 },
          target_deal: { type: "string", maxLength: 200 },
          strategy: { type: "string", maxLength: 1500 }
        },
        additionalProperties: false
      },
      notes: { type: "string", maxLength: 3000 },
      links: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 150 },
            url: { type: "string", maxLength: 1000 }
          },
          required: ["title", "url"],
          additionalProperties: false
        }
      },
      completed: { type: "boolean" }
    },
    required: ["title", "type", "deal_alert", "completed"],
    additionalProperties: false
  }
} satisfies CollectionOptions;

export default itemsCollectionOptions;