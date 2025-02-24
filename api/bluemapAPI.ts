interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface MarkerBase {
  label: string;
  position?: Vector3;
  maxDistance?: number;
  minDistance?: number;
}

interface POIMarkerOptions extends MarkerBase {
  icon?: string;
}

interface HTMLMarkerOptions extends MarkerBase {
  html: string;
}

interface LineMarkerOptions extends MarkerBase {
  line: Vector3[];
  lineWidth?: number;
  lineColor?: Color;
}

interface ShapeMarkerOptions extends MarkerBase {
  shape: Vector3[];
  shapeY: number;
  lineWidth?: number;
  lineColor?: Color;
  fillColor?: Color;
}

interface ExtrudeMarkerOptions extends MarkerBase {
  shape: Vector3[];
  shapeMinY: number;
  shapeMaxY: number;
  lineWidth?: number;
  lineColor?: Color;
  fillColor?: Color;
}

interface MarkerSetOptions {
  label?: string;
  toggleable?: boolean;
  defaultHidden?: boolean;
  sorting?: number;
}

export function createBlueMapAPI(
  sendToMinecraft: (data: unknown) => Promise<unknown>,
  log: (message: string) => void,
) {
  const createBlueMapCommand = (
    subcommand: string,
    args: Record<string, any>,
  ) => {
    return {
      type: "bluemap",
      data: {
        subcommand,
        arguments: args,
      },
    };
  };

  return {
    // Marker Set Management
    async createMarkerSet(id: string, options: MarkerSetOptions = {}) {
      return await sendToMinecraft(createBlueMapCommand("createSet", {
        id,
        data: JSON.stringify({
          label: options.label ?? id,
          toggleable: options.toggleable ?? true,
          defaultHidden: options.defaultHidden ?? false,
          sorting: options.sorting ?? 0,
        }),
      }));
    },

    async removeMarkerSet(id: string) {
      return await sendToMinecraft(createBlueMapCommand("removeSet", {
        id,
      }));
    },

    async listMarkerSets() {
      return await sendToMinecraft(createBlueMapCommand("listSets", {
        data: "",
      }));
    },

    // Marker Management
    async addMarker(
      markerset: string,
      markerid: string,
      type: string,
      data:
        | POIMarkerOptions
        | HTMLMarkerOptions
        | LineMarkerOptions
        | ShapeMarkerOptions
        | ExtrudeMarkerOptions,
    ) {
      return await sendToMinecraft(createBlueMapCommand("add", {
        markerset,
        markerid,
        type,
        data: JSON.stringify(data),
      }));
    },

    async removeMarker(markerset: string, markerid: string) {
      return await sendToMinecraft(createBlueMapCommand("remove", {
        markerset,
        markerid,
      }));
    },
  };
}
