import { Link } from "react-router";
import { Plus } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import {
  AccordionMenu,
  AccordionMenuIndicator,
  AccordionMenuSub,
  AccordionMenuSubTrigger,
  AccordionMenuSubContent,
  AccordionMenuItem,
} from '@/components/ui/accordion-menu';
import { Button } from "@/components/ui/button";

export function SidebarCommunities() {
  const communities = [
    {
      id: 1,
      title: 'Designers Hub',
      description: 'A community for creative designers.',
      icon: 'plus',
      logo: 'invision.svg',
    },
    {
      id: 2,
      title: 'React Js',
      description: 'Everything about frontend development.',
      icon: 'plus',
      logo: 'react.svg',
    },
    {
      id: 3,
      title: 'Node Js',
      description: 'Server-side development community.',
      icon: 'plus',
      logo: 'nodejs.svg',
    },
  ];

  return (
    <AccordionMenu
      type="single"
      collapsible
      defaultValue="communities-trigger"
      selectedValue="communities-trigger"
      className="space-y-7.5 px-2.5"
      classNames={{
        item: 'h-8.5 px-2.5 text-sm font-normal text-foreground hover:text-primary data-[selected=true]:bg-gray-100 data-[selected=true]:text-foreground [&[data-selected=true]_svg]:opacity-100',
        subTrigger: 'text-xs font-normal text-muted-foreground hover:bg-transparent',
        subContent: 'ps-0',
      }}
    >
        <AccordionMenuSub value="communities">
          <AccordionMenuSubTrigger value="communities-trigger">
            <span>Communities</span>
            <AccordionMenuIndicator />
          </AccordionMenuSubTrigger>
          <AccordionMenuSubContent type="single" collapsible parentValue="communities-trigger">
            <AccordionMenuItem value="add-community" asChild>
              <Button variant="ghost" className="flex items-center gap-2 w-full justify-start font-normal text-[13px]">
                <Plus />Create a community
              </Button>
            </AccordionMenuItem>

            {communities.map((community, index) => (
              <AccordionMenuItem key={index} value={`community-${community.id}`} asChild>
                <Link to="#" >
                  <img
                    src={toAbsoluteUrl(`/media/brand-logos/${community.logo}`)}
                    className="w-4.5 h-4.5 shrink-0"
                    alt="image"
                  />
                  {community.title}
                </Link>
              </AccordionMenuItem>
            ))}

          </AccordionMenuSubContent>
        </AccordionMenuSub>
      </AccordionMenu>
  );
}
