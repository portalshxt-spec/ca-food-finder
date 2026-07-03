"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FoodLocation } from "@/lib/types";

const TYPE_COLORS: Record<string, string> = {
  food_pantry: "#16a34a",
  meal_site: "#ea580c",
  donation_dropoff: "#2563eb",
};

interface Props {
  locations: FoodLocation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  userPoint: { lat: number; lng: number } | null;
}

const CA_CENTER: [number, number] = [-119.5, 37.2];

export default function MapView({
  locations,
  selectedId,
  onSelect,
  userPoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: CA_CENTER,
      zoom: 5.2,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("locations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "loc-circles",
        type: "circle",
        source: "locations",
        paint: {
          "circle-radius": [
            "case",
            ["boolean", ["get", "selected"], false],
            10,
            6,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-width": [
            "case",
            ["boolean", ["get", "selected"], false],
            3,
            1.5,
          ],
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "loc-circles", (e) => {
        const f = e.features?.[0];
        if (f) onSelectRef.current(String(f.properties?.id));
      });
      map.on("click", (e) => {
        const fs = map.queryRenderedFeatures(e.point, {
          layers: ["loc-circles"],
        });
        if (!fs.length) onSelectRef.current(null);
      });
      map.on("mouseenter", "loc-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "loc-circles", () => {
        map.getCanvas().style.cursor = "";
      });
      // trigger initial data render
      map.fire("styledata");
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // sync data + selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("locations") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData({
        type: "FeatureCollection",
        features: locations.map((l) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [l.lng, l.lat] },
          properties: {
            id: l.id,
            color: TYPE_COLORS[l.type] ?? "#16a34a",
            selected: l.id === selectedId,
          },
        })),
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [locations, selectedId]);

  // fly to user point; fly back out to statewide when it's cleared
  const hadPointRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userPoint) {
      hadPointRef.current = true;
      map.flyTo({ center: [userPoint.lng, userPoint.lat], zoom: 11 });
    } else if (hadPointRef.current) {
      hadPointRef.current = false;
      map.flyTo({ center: CA_CENTER, zoom: 5.2 });
    }
  }, [userPoint]);

  // user point marker
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (userPoint) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:16px;height:16px;border-radius:50%;background:#7c3aed;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)";
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userPoint.lng, userPoint.lat])
        .addTo(map);
    }
  }, [userPoint]);

  // fly to selected location
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const loc = locations.find((l) => l.id === selectedId);
    if (loc) {
      map.flyTo({
        center: [loc.lng, loc.lat],
        zoom: Math.max(map.getZoom(), 12),
      });
    }
  }, [selectedId, locations]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      role="application"
      aria-label="Map of food resource locations"
    />
  );
}
