"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Global script loading state — shared across all instances
let googleMapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  // Already loaded (e.g. from a previous page navigation)
  if (typeof google !== "undefined" && google.maps?.places) {
    googleMapsLoadPromise = Promise.resolve();
    return googleMapsLoadPromise;
  }

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleMapsLoadPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Start typing an address...",
  required,
  className,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Stable callback ref to avoid re-attaching listener
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Load Google Maps script
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return; // Falls back to plain input

    loadGoogleMaps(apiKey)
      .then(() => setLoaded(true))
      .catch(() => {}); // Silently degrade — plain input still works
  }, []);

  // Attach autocomplete once script is loaded
  useEffect(() => {
    if (!loaded || !inputRef.current || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "us" },
      types: ["address"],
      fields: ["formatted_address", "address_components"],
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        onChangeRef.current(place.formatted_address);
      }
    });

    autocompleteRef.current = autocomplete;

    return () => {
      google.maps.event.clearInstanceListeners(autocomplete);
      autocompleteRef.current = null;
    };
  }, [loaded]);

  // Keep input value in sync (for controlled component)
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  return (
    <input
      ref={inputRef}
      type="text"
      required={required}
      value={value}
      onChange={handleInput}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
    />
  );
}
