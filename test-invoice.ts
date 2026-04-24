import { database } from "./src/configs/connection.config";
import { invoices } from "./src/schema/schema";
import { randomUUID } from "crypto";

async function test() {
  try {
    const invoiceData = {
      id: randomUUID(),
      organizationId: "90f75025d14a49b89f7f4add2a5312cd",
      clientId: "b19f8b2d-ca19-4916-adde-0bf254a50488",
      createdBy: "L3kCKm82xjOeGbhzP1YaR9jO8fAUnQEa",
      invoiceNumber: "S1-00001-" + Date.now(), // avoid unique constraint
      clientname: "Hamza Hashmi",
      amount: "500",
      status: "draft",
      description: "this is a big invoice",
      dueDate: new Date("2026-04-14T00:00:00.000Z"),
      pdfUrl: null,
      pdfFileName: null,
      pdfFileSize: null,
    };
    
    console.log("Inserting...");
    const result = await database.insert(invoices).values(invoiceData as any).returning();
    console.log("Success:", result);
  } catch (err: any) {
    console.error("FAIL:", err);
    console.log("Error details:", JSON.stringify(err, null, 2));
  }
  process.exit();
}

test();
