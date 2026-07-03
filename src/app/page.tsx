import Finder from "@/components/Finder";
import { getLocationsFile } from "@/lib/data";

export default function Home() {
  const { locations, metros } = getLocationsFile();
  return <Finder locations={locations} metros={metros} />;
}
