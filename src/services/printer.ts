
/**
 * Printer service for direct WebUSB ESC/POS printing.
 */

const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  INIT: new Uint8Array([ESC, 0x40]),
  ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0x00]),
  ALIGN_CENTER: new Uint8Array([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: new Uint8Array([ESC, 0x61, 0x02]),
  CUT: new Uint8Array([GS, 0x56, 0x00]),
  LINE_FEED: new Uint8Array([0x0a]),
};

export async function printSessionReceipt(sessionId: string) {
  const VENDOR_ID = Number(import.meta.env.VITE_PRINTER_VENDOR_ID) || undefined;
  const PRODUCT_ID = Number(import.meta.env.VITE_PRINTER_PRODUCT_ID) || undefined;
  const PUBLIC_BASE_URL = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
  const summaryUrl = `${PUBLIC_BASE_URL}/session/${sessionId}`;

  let device: USBDevice | undefined;

  try {
    const devices = await navigator.usb.getDevices();
    device = devices.find(d => 
      (!VENDOR_ID || d.vendorId === VENDOR_ID) && 
      (!PRODUCT_ID || d.productId === PRODUCT_ID)
    );

    if (!device) {
      const filters = VENDOR_ID ? [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] : [];
      device = await navigator.usb.requestDevice({ filters });
    }

    if (!device) {
      throw new Error("No printer device selected.");
    }

    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // Find the first interface with a bulk OUT endpoint
    let interfaceNumber = 0;
    let endpointNumber = 0;

    const interfaces = device.configuration?.interfaces || [];
    for (const iface of interfaces) {
      const alternate = iface.alternate;
      const endpoint = alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
      if (endpoint) {
        interfaceNumber = iface.interfaceNumber;
        endpointNumber = endpoint.endpointNumber;
        break;
      }
    }

    if (endpointNumber === 0) {
      throw new Error("No bulk OUT endpoint found on printer.");
    }

    await device.claimInterface(interfaceNumber);

    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    const addText = (text: string) => chunks.push(encoder.encode(text));
    const addCmd = (cmd: Uint8Array) => chunks.push(cmd);
    const addLF = (count = 1) => {
      for (let i = 0; i < count; i++) addCmd(COMMANDS.LINE_FEED);
    };

    addCmd(COMMANDS.INIT);
    addCmd(COMMANDS.ALIGN_CENTER);
    addText("VOICEIT");
    addLF(1);
    addText("SESSION RECEIPT");
    addLF(2);
    
    addCmd(COMMANDS.ALIGN_LEFT);
    addText("Session Complete");
    addLF(1);
    addText("Thank you for using VoiceIt");
    addLF(2);

    const now = new Date();
    addText(`Date: ${now.toLocaleDateString()}`);
    addLF(1);
    addText(`Time: ${now.toLocaleTimeString()}`);
    addLF(2);
    addText(`Session ID: ${sessionId}`);
    addLF(2);

    addText("The QR code on the screen allows access to:");
    addLF(1);
    addText("- Questions");
    addLF(1);
    addText("- Answers");
    addLF(1);
    addText("- Source Documents");
    addLF(2);

    addText("Summary URL:");
    addLF(1);
    addText(summaryUrl);
    addLF(2);

    addText("Contact Information:");
    addLF(1);
    addText("Tel: 869-467-1623");
    addLF(1);
    addText("Email: info@lawcommission.gov.kn");
    addLF(2);

    addCmd(COMMANDS.ALIGN_CENTER);
    addText("Powered by Cherami Ltd.");
    addLF(1);
    addText("868-222-0011");
    addLF(4);

    addCmd(COMMANDS.CUT);

    const combined = new Uint8Array(chunks.reduce((acc, curr) => acc + curr.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    await device.transferOut(endpointNumber, combined);
    console.log("Receipt printed successfully.");

  } catch (error) {
    console.error("Printer error:", error);
    // Re-throw to allow caller to handle if needed, but the prompt says "do not crash the app"
    // and "show only a minimal non-disruptive print failure message".
    // We'll handle the UI part in App.tsx.
    throw error;
  } finally {
    if (device && device.opened) {
      try {
        await device.close();
      } catch (e) {}
    }
  }
}
