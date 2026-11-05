export const YardName = {
  /**
   * The name people search for. A yard listed under a short brand whose
   * operator extends it ("Pick Your Part - Sun Valley", run by "LKQ Pick Your
   * Part") reads as "LKQ Pick Your Part - Sun Valley"; other names are kept.
   */
  headline(name: string, operator: string | null): string {
    const [brand, ...location] = name.split(" - ");
    if (
      !operator ||
      !brand ||
      location.length === 0 ||
      operator.toLowerCase() === brand.toLowerCase() ||
      !operator.toLowerCase().endsWith(brand.toLowerCase())
    ) {
      return name;
    }
    return [operator, ...location].join(" - ");
  },
} as const;
